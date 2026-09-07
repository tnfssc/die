import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { registerProjectMemory } from "../src/memory/extension";
import { consumePendingNotes, snapshotPendingNotes } from "../src/memory/store";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "die-memory-"));
  dirs.push(dir);
  return dir;
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const receiptFrom = (prompt: string) =>
  prompt.match(
    /nonce receipt file (.+\.consolidation-[a-f0-9-]+\.json) containing/,
  )![1]!;

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
      notify: (message: string, kind?: string) =>
        notices.push({ message, kind }),
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
    for (const handler of handlers.get(name) ?? [])
      out = await handler(...args);
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

async function writeReceipt(
  cwd: string,
  prompt: string,
  files: Array<{ path: string; content: string }>,
) {
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
    f.commands
      .get("memory")
      .handler("consolidate fast --constraints none", f.ctx),
    f.commands
      .get("memory")
      .handler("consolidate normal --constraints concise", f.ctx),
  ]);
  expect(f.launches).toHaveLength(1);
  expect(f.launches[0].params).toMatchObject({ type: "fast", waitSeconds: 0 });
  const prompt = f.launches[0].params.prompt as string;
  expect(prompt).toContain(
    "constraints (authoritative; preserve exactly):\nnone",
  );
  expect(prompt).toContain("Merge, reorganize, and deduplicate");
  expect(prompt).toContain("short nested topic index.md");
  expect(prompt).toContain("untrusted data");
  expect(prompt).toContain(
    "holds .consolidation.lock for this run on your behalf",
  );
  expect(prompt).not.toContain("untrusted secret");
});

test("an immediately completed launch is reconciled after its handle returns", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const f = fixture(cwd, {
    initialStatus: "completed",
    async onLaunch(params) {
      await writeReceipt(cwd, params.prompt, [
        { path: "index.md", content: "# Memory\n" },
      ]);
    },
  });
  await f.commands
    .get("memory")
    .handler("consolidate normal --constraints keep concise", f.ctx);
  expect(await snapshotPendingNotes(cwd)).toEqual([]);
  expect(f.notices.at(-1).message).toContain("consumed 1");
});

test("successful receipt marks the launched snapshot consumed but preserves a modified retry", async () => {
  const cwd = await temp();
  const pending = await putPending(cwd);
  const f = fixture(cwd);
  await f.commands
    .get("memory")
    .handler("consolidate normal --constraints keep concise", f.ctx);
  await writeFile(pending, "modified after launch");
  const receipt = await writeReceipt(cwd, f.launches[0].params.prompt, [
    { path: "index.md", content: "# Memory\n" },
  ]);
  f.finish();
  await f.runtime.jobsChanged();

  expect(await readFile(pending, "utf8")).toBe("modified after launch");
  expect((await snapshotPendingNotes(cwd)).map((note) => note.content)).toEqual(
    ["modified after launch"],
  );
  expect(await Bun.file(receipt).exists()).toBe(false);
});

test("wrong hashes and receipts that omit index.md retain pending snapshots", async () => {
  for (const omitIndex of [false, true]) {
    const cwd = await temp();
    await putPending(cwd);
    const f = fixture(cwd);
    await f.commands
      .get("memory")
      .handler("consolidate fast --constraints none", f.ctx);
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
  await f.commands
    .get("memory")
    .handler("consolidate fast --constraints none", f.ctx);
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
    await f.commands
      .get("memory")
      .handler("consolidate fast --constraints none", f.ctx);
    await writeReceipt(cwd, f.launches[0].params.prompt, [
      { path: "index.md", content: "# Memory\n" },
    ]);
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
  const command = f.commands
    .get("memory")
    .handler("consolidate fast --constraints none", f.ctx);
  while (!f.launches.length)
    await new Promise((resolve) => setTimeout(resolve, 0));
  f.setSession("session-2");
  release();
  await command;
  expect(f.killed).toEqual([{ id: "task_mem", cause: "session-shutdown" }]);
});

test("shutdown cancels and the root system prompt only advertises the memory location", async () => {
  const cwd = await temp();
  await putPending(cwd, "a.md", "secret corpus");
  const f = fixture(cwd);
  await f.commands
    .get("memory")
    .handler("consolidate fast --constraints none", f.ctx);
  await f.fire("session_shutdown", {}, f.ctx);
  expect(f.killed).toEqual([{ id: "task_mem", cause: "session-shutdown" }]);
  const root = fixture(cwd);
  const result = await root.fire(
    "before_agent_start",
    { systemPrompt: "base" },
    root.ctx,
  );
  expect(result.systemPrompt).toContain("index.md");
  expect(result.systemPrompt).toContain("cooperative memory lock");
  expect(result.systemPrompt).toContain(
    "ignore it remain outside this guarantee",
  );
  expect(result.systemPrompt).not.toContain("secret corpus");
  expect(
    await root.fire("context", { messages: [] }, root.ctx),
  ).toBeUndefined();
  root.setRoot(false);
  expect(
    await root.fire(
      "before_agent_start",
      { systemPrompt: "child base" },
      root.ctx,
    ),
  ).toBeUndefined();
});

test("empty notes, ordinary turns, and child sessions never dispatch consolidation", async () => {
  const cwd = await temp();
  const f = fixture(cwd);
  await f.commands
    .get("memory")
    .handler("consolidate fast --constraints none", f.ctx);
  expect(f.launches).toHaveLength(0);
  await putPending(cwd);
  await f.fire("agent_end", { messages: [] }, f.ctx);
  await f.fire("agent_settled", {}, f.ctx);
  await f.runtime.jobsChanged();
  expect(f.launches).toHaveLength(0);
  f.setRoot(false);
  await f.commands
    .get("memory")
    .handler("consolidate normal --constraints none", f.ctx);
  expect(f.launches).toHaveLength(0);
  await f.fire("session_shutdown", {}, f.ctx);
  expect(f.launches).toHaveLength(0);
});

test("project lease excludes other sessions and is released only after terminal completion", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const first = fixture(cwd),
    second = fixture(cwd);
  await first.commands
    .get("memory")
    .handler("consolidate fast --constraints none", first.ctx);
  await second.commands
    .get("memory")
    .handler("consolidate fast --constraints none", second.ctx);
  expect(second.launches).toHaveLength(0);
  expect(second.notices.at(-1).message).toContain("locked");
  await first.fire("session_shutdown", {}, first.ctx);
  await second.commands
    .get("memory")
    .handler("consolidate fast --constraints none", second.ctx);
  expect(second.launches).toHaveLength(0);
  first.finish();
  await first.runtime.jobsChanged();
  await second.commands
    .get("memory")
    .handler("consolidate fast --constraints none", second.ctx);
  expect(second.launches).toHaveLength(1);
  expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
});

test("missing save receipt retains notes and releases lease for explicit retry", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const f = fixture(cwd, { initialStatus: "completed" });
  await f.commands
    .get("memory")
    .handler("consolidate normal --constraints none", f.ctx);
  expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
  expect(f.notices.at(-1).message).toContain("no valid receipt");
  await f.commands
    .get("memory")
    .handler("consolidate fast --constraints none", f.ctx);
  expect(f.launches).toHaveLength(2);
});

test("failed worker never consumes even a valid save receipt", async () => {
  const cwd = await temp();
  await putPending(cwd);
  const f = fixture(cwd, {
    initialStatus: "failed",
    async onLaunch(params) {
      await writeReceipt(cwd, params.prompt, [
        { path: "index.md", content: "saved partial work" },
      ]);
    },
  });
  await f.commands
    .get("memory")
    .handler("consolidate fast --constraints none", f.ctx);
  expect(await snapshotPendingNotes(cwd)).toHaveLength(1);
  expect(f.notices.at(-1).message).toContain(
    "failed; pending notes were retained",
  );
});
