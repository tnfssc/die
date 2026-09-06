import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/tasks/extension";
import { snapshotPendingNotes } from "../src/memory/store";

const originalDepth = process.env.DIE_SUBAGENT_DEPTH;
const originalType = process.env.DIE_SUBAGENT_TYPE;
const originalExecPath = process.execPath;
const temporaryDirectories: string[] = [];
afterEach(async () => {
  if (originalDepth === undefined) delete process.env.DIE_SUBAGENT_DEPTH;
  else process.env.DIE_SUBAGENT_DEPTH = originalDepth;
  if (originalType === undefined) delete process.env.DIE_SUBAGENT_TYPE;
  else process.env.DIE_SUBAGENT_TYPE = originalType;
  process.execPath = originalExecPath;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

type TestContext = ExtensionContext & { notices: Array<{ message: string; level?: string }> };

function context(cwd: string, sessionManager: SessionManager): TestContext {
  const notices: TestContext["notices"] = [];
  return {
    cwd,
    sessionManager,
    notices,
    ui: {
      notify(message: string, level?: string) {
        notices.push({ message, level });
      },
      setStatus() {},
    } as unknown as ExtensionContext["ui"],
    mode: "print",
    hasUI: false,
    model: undefined,
    scopedModels: [],
    modelRegistry: {
      runtime: { streamSimple() {}, async prepareRequest() {}, isUsingOAuth: () => false },
      isUsingOAuth: () => false,
    } as unknown as ExtensionContext["modelRegistry"],
    isIdle: () => true,
    signal: new AbortController().signal,
    isProjectTrusted: () => true,
    abort() {},
    hasPendingMessages: () => false,
    shutdown() {},
    getContextUsage: () => undefined,
    compact() {},
    getSystemPrompt: () => "base",
  };
}

function harness(options: { profilesPath: string }) {
  const commands = new Map<string, any>();
  const handlers = new Map<string, Function[]>();
  extension(
    {
      registerTool() {},
      registerCommand(name: string, command: unknown) {
        commands.set(name, command);
      },
      registerFlag() {},
      getFlag: () => false,
      registerMessageRenderer() {},
      on(event: string, handler: Function) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      setActiveTools() {},
      sendMessage() {},
    } as any,
    options,
  );
  return {
    commands,
    async fire(event: string, payload: unknown, ctx: ExtensionContext) {
      for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
    },
  };
}

async function putPending(cwd: string, name: string, content: string) {
  const directory = join(cwd, ".agents", "notes", ".pending");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), content);
}

async function waitFor(check: () => boolean, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(10);
  expect(check()).toBe(true);
}

test("task extension routes project memory through managed jobs and restored root identity", async () => {
  process.env.DIE_SUBAGENT_DEPTH = "0";
  delete process.env.DIE_SUBAGENT_TYPE;
  const cwd = await mkdtemp(join(tmpdir(), "die-memory-integration-"));
  temporaryDirectories.push(cwd);
  const sessions = join(cwd, "sessions");
  const profilesPath = join(cwd, "profiles.json");
  const launches = join(cwd, "worker-launches");
  const worker = join(cwd, "memory-worker");
  await writeFile(profilesPath, JSON.stringify({ fast: { model: "fixture/no-network" } }));
  await writeFile(
    worker,
    String.raw`#!/usr/bin/env bun
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
appendFileSync(${JSON.stringify(launches)}, "launch\n");
const prompt = process.argv.at(-1) ?? "";
const receipt = /nonce receipt file ([^\n]+) containing strict JSON/.exec(prompt)?.[1];
if (!receipt) process.exit(2);
const body = "# Project memory\n";
mkdirSync(join(process.cwd(), ".agents", "notes"), { recursive: true });
writeFileSync(join(process.cwd(), ".agents", "notes", "index.md"), body);
writeFileSync(receipt, JSON.stringify({ files: [{ path: "index.md", sha256: createHash("sha256").update(body).digest("hex") }] }));
`,
  );
  await chmod(worker, 0o755);
  process.execPath = worker;

  const e = harness({ profilesPath });
  const root = context(cwd, SessionManager.create(cwd, sessions));
  await e.fire("session_start", {}, root);
  const memory = e.commands.get("memory");
  expect(memory).toBeDefined();

  await memory.handler("consolidate fast --constraints none", root);
  expect(root.notices.at(-1)?.message).toContain("No pending Markdown notes");
  expect(await Bun.file(launches).exists()).toBe(false);

  await putPending(cwd, "root.md", "integration note");
  await memory.handler("consolidate fast --constraints none", root);
  await waitFor(() => root.notices.some((notice) => notice.message.includes("completed; consumed 1")));
  expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(1);
  expect(await snapshotPendingNotes(cwd)).toHaveLength(0);
  expect(await readFile(join(cwd, ".agents", "notes", "index.md"), "utf8")).toBe("# Project memory\n");
  await e.fire("session_shutdown", {}, root);

  // A newly restored child session must not inherit the root closure's privilege.
  const childManager = SessionManager.create(cwd, sessions);
  childManager.appendCustomEntry("die-agent", { type: "normal", depth: 1 });
  const child = context(cwd, childManager);
  const childExtension = harness({ profilesPath });
  await childExtension.fire("session_start", {}, child);
  await putPending(cwd, "child.md", "child note");
  await childExtension.commands.get("memory").handler("consolidate fast --constraints none", child);
  expect(child.notices.at(-1)?.message).toContain("root-only");
  expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(1);
  expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
  await childExtension.fire("session_shutdown", {}, child);
});
