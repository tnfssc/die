import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskLifecycleRecorder, taskLifecycleFile, TASK_LIFECYCLE_MAX_BYTES } from "../src/tasks/task-lifecycle";

test("ownership index survives recreation, retains every child past completion preview limit, and stays protected", () => {
  const dir = mkdtempSync(join(tmpdir(), "die-lifecycle-"));
  try {
    const session = join(dir, "owner.jsonl");
    const record = createTaskLifecycleRecorder(session);
    for (let i = 0; i < 60; i++)
      record({
        taskId: "task_" + i,
        kind: "agent",
        sessionFile: join(dir, "child-" + i + ".jsonl"),
        event: "completed",
      });
    createTaskLifecycleRecorder(session)({
      taskId: "task_shell",
      kind: "command",
      event: "stopping",
      terminationCause: "session-shutdown",
    });
    const lines = readFileSync(taskLifecycleFile(session), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(61);
    expect(lines[59].sessionFile).toBe(join(dir, "child-59.jsonl"));
    expect(lines[60].terminationCause).toBe("session-shutdown");
    expect(statSync(taskLifecycleFile(session)).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recorder binds original session path, bounds storage, and does not follow symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "die-lifecycle-"));
  try {
    let session = join(dir, "old.jsonl");
    const record = createTaskLifecycleRecorder(session);
    session = join(dir, "new.jsonl");
    for (let i = 0; i < 250; i++) record({ taskId: "task_" + i, sessionFile: "x".repeat(10_000) });
    const old = taskLifecycleFile(join(dir, "old.jsonl"));
    expect(statSync(old).size).toBeLessThanOrEqual(TASK_LIFECYCLE_MAX_BYTES);
    expect(
      readFileSync(old, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .at(-1).taskId,
    ).toBe("task_249");
    const target = join(dir, "target");
    writeFileSync(target, "unchanged");
    symlinkSync(target, taskLifecycleFile(session));
    let failures = 0;
    const failed = createTaskLifecycleRecorder(session, () => {
      failures++;
    });
    failed({ taskId: "task_1" });
    failed({ taskId: "task_2" });
    expect(failures).toBe(1);
    expect(readFileSync(target, "utf8")).toBe("unchanged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("short writes are completed without partial JSON records", () => {
  const dir = mkdtempSync(join(tmpdir(), "die-lifecycle-short-"));
  try {
    const session = join(dir, "owner.jsonl");
    let calls = 0;
    const shortWrite: typeof writeSync = ((
      fd: number,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ) => {
      calls++;
      return writeSync(fd, buffer, offset, Math.min(length, 3), position);
    }) as typeof writeSync;
    createTaskLifecycleRecorder(session, () => {}, { write: shortWrite })({
      taskId: "task_short",
      event: "completed",
    });
    expect(calls).toBeGreaterThan(2);
    expect(JSON.parse(readFileSync(taskLifecycleFile(session), "utf8"))).toEqual({
      taskId: "task_short",
      event: "completed",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent processes serialize records or explicitly report bounded contention", async () => {
  const dir = mkdtempSync(join(tmpdir(), "die-lifecycle-concurrent-"));
  try {
    const session = join(dir, "owner.jsonl");
    const modulePath = join(import.meta.dir, "../src/tasks/task-lifecycle.ts");
    const script =
      "import { createTaskLifecycleRecorder } from " +
      JSON.stringify(modulePath) +
      ";" +
      "let failed=0;const record=createTaskLifecycleRecorder(process.argv[1],()=>{failed++});" +
      "for(let i=0;i<100;i++)record({taskId:'task_'+process.argv[2]+'_'+i,event:'completed'});" +
      "console.log(JSON.stringify({failed}));";
    const children = Array.from({ length: 4 }, (_, index) =>
      Bun.spawn([process.execPath, "-e", script, session, String(index)], { stdout: "pipe", stderr: "pipe" }),
    );
    const failures = await Promise.all(
      children.map(async (child) => {
        const [exit, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(stderr).toBe("");
        expect(exit).toBe(0);
        return JSON.parse(stdout).failed as number;
      }),
    );
    const path = taskLifecycleFile(session);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const records = lines.map((line) => JSON.parse(line));
    expect(records.length).toBeGreaterThan(0);
    expect(failures.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);
    expect(records.length + failures.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(400);
    expect(new Set(records.map((record) => record.taskId)).size).toBe(records.length);
    expect(statSync(path).size).toBeLessThanOrEqual(TASK_LIFECYCLE_MAX_BYTES);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(path + ".lock")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dead-process lock is reclaimed and cannot permanently disable the index", () => {
  const dir = mkdtempSync(join(tmpdir(), "die-lifecycle-stale-"));
  try {
    const session = join(dir, "owner.jsonl");
    const path = taskLifecycleFile(session);
    writeFileSync(path + ".lock", JSON.stringify({ token: "dead", pid: 2_147_483_647, created: Date.now() }));
    let failure: string | undefined;
    createTaskLifecycleRecorder(session, (kind) => {
      failure = kind;
    })({ taskId: "task_recovered" });
    expect(failure).toBeUndefined();
    expect(JSON.parse(readFileSync(path, "utf8")).taskId).toBe("task_recovered");
    expect(existsSync(path + ".lock")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
