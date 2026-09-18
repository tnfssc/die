import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { registerProjectMemory } from "../src/memory/extension";
import { consumePendingNotes, snapshotPendingNotes } from "../src/memory/store";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "die-memory-"));
  dirs.push(dir);
  return dir;
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const receiptFrom = (prompt: string) =>
  prompt.match(/Save notes first\. Then write ([^\n]+\.consolidation-[a-f0-9-]+\.json) listing/)![1]!;

function fixture(
  cwd: string,
  options: {
    root?: boolean;
    onLaunch?: (params: any) => void | Promise<void>;
    initialStatus?: string;
  } = {},
) {
  const commands = new Map<string, any>();
  const handlers = new Map<string, Function[]>();
  const notices: any[] = [];
  const launches: any[] = [];
  const killed: any[] = [];
  let root = options.root ?? true;
  let sessionId = "session-1";
  let inspection: any = {
    id: "task_mem",
    status: options.initialStatus ?? "running",
    exitCode: options.initialStatus === "completed" ? 0 : undefined,
  };
  const sessionManager = { getSessionId: () => sessionId };
  const ctx: any = {
    cwd,
    sessionManager,
    ui: {
      notify: (message: string, kind?: string) => notices.push({ message, kind }),
    },
  };
  const pi: any = {
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
  };
  const jobs: any = {
    async handle(method: string, params: any, received: any) {
      launches.push({ method, params, received });
      await options.onLaunch?.(params);
      return { id: "task_mem", status: inspection.status };
    },
  };
  const manager: any = {
    inspect(id: string, offset?: number, limit?: number) {
      expect({ id, offset, limit }).toEqual({
        id: "task_mem",
        offset: 0,
        limit: 1,
      });
      return {
        ...inspection,
        output: "",
        requestedOffset: 0,
        nextOffset: 0,
        outputLost: false,
        hasMore: false,
      };
    },
    kill(id: string, cause: string) {
      killed.push({ id, cause });
    },
  };
  const runtime = registerProjectMemory(pi, {
    jobs,
    manager,
    isRoot: () => root,
  });
  const fire = async (name: string, ...args: any[]) => {
    let out;
    for (const handler of handlers.get(name) ?? []) out = await handler(...args);
    return out;
  };
  return {
    commands,
    notices,
    launches,
    killed,
    ctx,
    runtime,
    fire,
    finish() {
      inspection = { id: "task_mem", status: "completed", exitCode: 0 };
    },
    setSession(id: string) {
      sessionId = id;
    },
    setRoot(value: boolean) {
      root = value;
    },
  };
}

async function putPending(cwd: string, name = "a.md", content = "pending") {
  const path = join(cwd, ".agents/notes/.pending", name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

async function writeReceipt(cwd: string, prompt: string, files: Array<{ path: string; content: string }>) {
  for (const file of files) {
    const path = join(cwd, ".agents/notes", file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
  const receipt = receiptFrom(prompt);
  await writeFile(
    receipt,
    JSON.stringify({
      files: files.map((file) => ({
        path: file.path,
        sha256: sha(file.content),
      })),
    }),
  );
  return receipt;
}

test("store consumption is content-addressed and a modified pending note remains retryable", async () => {
  const cwd = await temp();
  const pending = await putPending(cwd, "one.md", "one");
  await putPending(cwd, ".hidden.md", "hidden");
  await mkdir(join(cwd, ".agents/notes/.pending/nested"));
  await writeFile(join(cwd, ".agents/notes/.pending/nested/two.md"), "two");

  const snapshot = await snapshotPendingNotes(cwd);
  expect(snapshot.map((file) => file.path)).toEqual([
    ".agents/notes/.pending/.hidden.md",
    ".agents/notes/.pending/one.md",
  ]);
  expect(await consumePendingNotes(cwd, snapshot)).toEqual({
    consumed: snapshot.map((file) => file.path),
    retained: [],
  });
  expect(await readFile(pending, "utf8")).toBe("one");
  expect(await snapshotPendingNotes(cwd)).toEqual([]);

  await writeFile(pending, "changed");
  const retry = await snapshotPendingNotes(cwd);
  expect(retry).toHaveLength(1);
  expect(retry[0]).toMatchObject({
    path: ".agents/notes/.pending/one.md",
    content: "changed",
  });
});

test("command is explicit, requires constraints, and reserves concurrent launches synchronously", async () => {
  const cwd = await temp();
  const f = fixture(cwd);
  await putPending(cwd, "a.md", "untrusted secret");
  expect(f.launches).toHaveLength(0);
  await f.commands.get("memory").handler("consolidate fast", f.ctx);
  expect(f.notices.at(-1).message).toContain("--constraints");

  await Promise.all([
    f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx),
    f.commands.get("memory").handler("consolidate normal --constraints concise", f.ctx),
  ]);
  expect(f.launches).toHaveLength(1);
  expect(f.launches[0].params).toMatchObject({ type: "fast", waitSeconds: 0 });
  const prompt = f.launches[0].params.prompt as string;
  expect(prompt).toStartWith("Read pending notes. Merge what's useful into project memory.");
  expect(prompt).toContain("constraints (authoritative; preserve exactly):\nnone");
  expect(prompt).toContain("Group related notes, merge repeats, keep it short.");
  expect(prompt).toContain("add small topic index.md files when useful");
  expect(prompt).toContain("Die handles marking pending notes consumed.");
  expect(prompt).not.toContain("untrusted data");
  expect(prompt).not.toContain("untrusted secret");
});

test("worker launcher renders canonical Markdown once and preserves literal dynamic input", async () => {
  const parent = await temp();
  const cwd = join(parent, "cwd-{{constraints}}-$&");
  await mkdir(cwd);
  const pendingName = "literal-{{cwd}}-$&-$$.md";
  await putPending(cwd, pendingName, "note body must not enter the prompt");
  const constraints = "Keep {{paths}}, {{cwd}}, and {{receipt}} literal; preserve $& $$ $` $'.";
  const f = fixture(cwd);

  await f.commands.get("memory").handler("consolidate normal --constraints " + constraints, f.ctx);

  expect(f.launches).toHaveLength(1);
  const prompt = f.launches[0].params.prompt as string;
  const receipt = receiptFrom(prompt);
  const source = await Bun.file(new URL("../src/prompts/memory-consolidation.md", import.meta.url)).text();
  const values = {
    constraints,
    paths: "- .agents/notes/.pending/" + pendingName,
    cwd,
    receipt,
  };
  expect(prompt).toBe(
    source.trimEnd().replace(/{{(constraints|paths|cwd|receipt)}}/g, (_match, key: keyof typeof values) => values[key]),
  );
  expect(prompt).toContain(constraints);
  expect(prompt).toContain(values.paths);
  expect(prompt).toContain(cwd + "/.agents/notes");
  expect(prompt).toContain(receipt);
  expect(prompt).not.toContain("note body must not enter the prompt");
});
test("accepted consolidation visibly reports nonblocking background work exactly once", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const f = fixture(cwd);

  const command = f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
  await expect(Promise.race([command.then(() => "resolved"), Bun.sleep(250).then(() => "blocked")])).resolves.toBe(
    "resolved",
  );

  const launchNotices = () => f.notices.filter((notice) => notice.message.includes("is running in the background"));
  expect(launchNotices()).toHaveLength(1);
  expect(launchNotices()[0].message).toContain("keep working or talking in this session");
  expect(launchNotices()[0].message).toContain("no need to wait");

  // A new conversational turn remains available while the worker is still running.
  const nextTurn = await f.fire("before_agent_start", { systemPrompt: "next turn" }, f.ctx);
  expect(nextTurn.systemPrompt).toStartWith("next turn");
  await Promise.all([f.runtime.jobsChanged(), f.runtime.jobsChanged(), f.runtime.jobsChanged()]);
  expect(launchNotices()).toHaveLength(1);
});

test("an already-aborted dispatch is known pre-spawn and permits retry", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const aborted = fixture(cwd);
  aborted.ctx.signal = AbortSignal.abort();
  await aborted.commands.get("memory").handler("consolidate fast --constraints none", aborted.ctx);
  expect(aborted.launches).toHaveLength(0);

  const retry = fixture(cwd);
  await retry.commands.get("memory").handler("consolidate fast --constraints none", retry.ctx);
  expect(retry.launches).toHaveLength(1);
});

test("over-limit pending input is retained and never dispatched", async () => {
  const cwd = await temp();
  const pending = await putPending(cwd);
  await truncate(pending, 1024 * 1024 + 1);
  const f = fixture(cwd);
  await f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
  expect(f.launches).toHaveLength(0);
  expect(f.notices.at(-1).message).toContain("byte limit");
  expect(await Bun.file(pending).exists()).toBe(true);
});

test("a receipt-listed file over its read bound retains pending input", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const f = fixture(cwd);
  await f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
  const output = join(cwd, ".agents/notes/index.md");
  await writeFile(output, "");
  await truncate(output, 2 * 1024 * 1024 + 1);
  await writeFile(
    receiptFrom(f.launches[0].params.prompt),
    JSON.stringify({ files: [{ path: "index.md", sha256: sha("") }] }),
  );
  f.finish();
  await f.runtime.jobsChanged();
  expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
  expect(f.notices.at(-1).message).toContain("no valid receipt");
});

test("an immediately completed launch is reconciled after its handle returns", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const f = fixture(cwd, {
    initialStatus: "completed",
    async onLaunch(params) {
      await writeReceipt(cwd, params.prompt, [{ path: "index.md", content: "# Memory\n" }]);
    },
  });
  await f.commands.get("memory").handler("consolidate normal --constraints keep concise", f.ctx);
  expect(await snapshotPendingNotes(cwd)).toEqual([]);
  expect(f.notices.at(-1).message).toContain("consumed 1");
});

test("successful receipt marks the launched snapshot consumed but preserves a modified retry", async () => {
  const cwd = await temp();
  const pending = await putPending(cwd);
  const f = fixture(cwd);
  await f.commands.get("memory").handler("consolidate normal --constraints keep concise", f.ctx);
  await writeFile(pending, "modified after launch");
  const receipt = await writeReceipt(cwd, f.launches[0].params.prompt, [{ path: "index.md", content: "# Memory\n" }]);
  f.finish();
  await f.runtime.jobsChanged();

  expect(await readFile(pending, "utf8")).toBe("modified after launch");
  expect((await snapshotPendingNotes(cwd)).map((note) => note.content)).toEqual(["modified after launch"]);
  expect(await Bun.file(receipt).exists()).toBe(false);
});

test("wrong hashes and receipts that omit index.md retain pending snapshots", async () => {
  for (const omitIndex of [false, true]) {
    const cwd = await temp();
    await putPending(cwd);
    const f = fixture(cwd);
    await f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
    const prompt = f.launches[0].params.prompt as string;
    await mkdir(join(cwd, ".agents/notes/topic"), { recursive: true });
    await writeFile(join(cwd, ".agents/notes/index.md"), "# Memory\n");
    await writeFile(join(cwd, ".agents/notes/topic/index.md"), "topic");
    const files = omitIndex
      ? [{ path: "topic/index.md", sha256: sha("topic") }]
      : [{ path: "index.md", sha256: sha("wrong") }];
    await writeFile(receiptFrom(prompt), JSON.stringify({ files }));
    f.finish();
    await f.runtime.jobsChanged();
    expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
    expect(f.notices.at(-1).message).toContain("no valid receipt");
  }
});

test("receipt validation rejects symlinked managed topic ancestors", async () => {
  const cwd = await temp();
  const outside = await temp();
  await putPending(cwd);
  const f = fixture(cwd);
  await f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
  await writeFile(join(cwd, ".agents/notes/index.md"), "# Memory\n");
  await writeFile(join(outside, "index.md"), "outside");
  await symlink(outside, join(cwd, ".agents/notes/topic"));
  await writeFile(
    receiptFrom(f.launches[0].params.prompt),
    JSON.stringify({
      files: [
        { path: "index.md", sha256: sha("# Memory\n") },
        { path: "topic/index.md", sha256: sha("outside") },
      ],
    }),
  );
  f.finish();
  await f.runtime.jobsChanged();
  expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
});

test("session-id reuse and changed root policy invalidate completion", async () => {
  for (const invalidate of ["session", "root"] as const) {
    const cwd = await temp();
    await putPending(cwd);
    const f = fixture(cwd);
    await f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
    await writeReceipt(cwd, f.launches[0].params.prompt, [{ path: "index.md", content: "# Memory\n" }]);
    if (invalidate === "session") f.setSession("session-2");
    else f.setRoot(false);
    f.finish();
    await f.runtime.jobsChanged();
    expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
  }
});

test("session switch while launch handle is pending kills the returned job", async () => {
  const cwd = await temp();
  await putPending(cwd);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(cwd, { onLaunch: () => blocked });
  const command = f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
  while (!f.launches.length) await new Promise((resolve) => setTimeout(resolve, 0));
  f.setSession("session-2");
  release();
  await command;
  expect(f.killed).toEqual([{ id: "task_mem", cause: "session-shutdown" }]);
});

test("shutdown cancels and root memory guidance comes from Markdown without loading the corpus", async () => {
  const cwd = await temp();
  await putPending(cwd, "a.md", "secret corpus");
  const f = fixture(cwd);
  await f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
  await f.fire("session_shutdown", {}, f.ctx);
  expect(f.killed).toEqual([{ id: "task_mem", cause: "session-shutdown" }]);
  const root = fixture(cwd);
  const result = await root.fire("before_agent_start", { systemPrompt: "base" }, root.ctx);
  const source = await Bun.file(new URL("../src/prompts/memory.md", import.meta.url)).text();
  expect(result.systemPrompt).toBe("base\n\n" + source.trimEnd());
  expect(result.systemPrompt).toContain("Save decisions, reasons, and where work stopped.");
  expect(result.systemPrompt).toContain(
    "Work not done if next person cannot pick it up. Leave code and notes together, where others can get both. Say what finished and what still needs care.",
  );
  expect(result.systemPrompt).toContain("index.md");
  expect(result.systemPrompt).not.toContain("secret corpus");
  expect(await root.fire("context", { messages: [] }, root.ctx)).toBeUndefined();
  root.setRoot(false);
  expect(await root.fire("before_agent_start", { systemPrompt: "child base" }, root.ctx)).toBeUndefined();
});

test("empty notes, ordinary turns, and child sessions never dispatch consolidation", async () => {
  const cwd = await temp();
  const f = fixture(cwd);
  await f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
  expect(f.launches).toHaveLength(0);
  await putPending(cwd);
  await f.fire("agent_end", { messages: [] }, f.ctx);
  await f.fire("agent_settled", {}, f.ctx);
  await f.runtime.jobsChanged();
  expect(f.launches).toHaveLength(0);
  f.setRoot(false);
  await f.commands.get("memory").handler("consolidate normal --constraints none", f.ctx);
  expect(f.launches).toHaveLength(0);
  await f.fire("session_shutdown", {}, f.ctx);
  expect(f.launches).toHaveLength(0);
});

test("missing save receipt retains notes for explicit retry", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const f = fixture(cwd, { initialStatus: "completed" });
  await f.commands.get("memory").handler("consolidate normal --constraints none", f.ctx);
  expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
  expect(f.notices.at(-1).message).toContain("no valid receipt");
  await f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
  expect(f.launches).toHaveLength(2);
});

test("failed worker never consumes even a valid save receipt", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const f = fixture(cwd, {
    initialStatus: "failed",
    async onLaunch(params) {
      await writeReceipt(cwd, params.prompt, [{ path: "index.md", content: "saved partial work" }]);
    },
  });
  await f.commands.get("memory").handler("consolidate fast --constraints none", f.ctx);
  expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
  expect(f.notices.at(-1).message).toContain("failed; pending notes were retained");
});
