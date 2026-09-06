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
    const failureCount = failures.reduce((sum, value) => sum + value, 0);
    expect(records.length).toBeGreaterThan(0);
    expect(failureCount).toBeGreaterThan(0);
    expect(records.length + failureCount).toBe(400);
    expect(new Set(records.map((record) => record.taskId)).size).toBe(records.length);
    expect(statSync(path).size).toBeLessThanOrEqual(TASK_LIFECYCLE_MAX_BYTES);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(path + ".lock")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live contention is nonfatal and SIGKILL releases the kernel lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "die-lifecycle-kill-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const session = join(dir, "owner.jsonl");
    const path = taskLifecycleFile(session);
    const ready = join(dir, "ready");
    createTaskLifecycleRecorder(session)({ taskId: "before" });
    const holder =
      'import {dlopen,FFIType} from "bun:ffi";' +
      'import {openSync,writeFileSync} from "node:fs";' +
      'const lib=dlopen("libc.so.6",{flock:{args:[FFIType.i32,FFIType.i32],returns:FFIType.i32}});' +
      'const fd=openSync(process.argv[1],"r+");' +
      "if(lib.symbols.flock(fd,2)!==0)process.exit(2);" +
      'writeFileSync(process.argv[2],"ready");await Bun.sleep(60000);';
    child = Bun.spawn([process.execPath, "-e", holder, path, ready], { stderr: "pipe" });
    for (let i = 0; i < 100 && !existsSync(ready); i++) await Bun.sleep(10);
    expect(existsSync(ready)).toBe(true);

    const failures: string[] = [];
    createTaskLifecycleRecorder(session, (failure) => failures.push(failure ?? "unknown"))({ taskId: "blocked" });
    expect(failures).toEqual(["contention"]);
    expect(readFileSync(path, "utf8")).not.toContain("blocked");

    child.kill("SIGKILL");
    await child.exited;
    child = undefined;
    createTaskLifecycleRecorder(session, (failure) => failures.push(failure ?? "unknown"))({ taskId: "after" });
    expect(
      readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .map((record) => record.taskId),
    ).toEqual(["before", "after"]);
    expect(existsSync(path + ".lock")).toBe(false);
  } finally {
    child?.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unavailable locking backend fails closed with a coalesced diagnostic", () => {
  const dir = mkdtempSync(join(tmpdir(), "die-lifecycle-no-lock-"));
  try {
    const session = join(dir, "owner.jsonl");
    const failures: string[] = [];
    const record = createTaskLifecycleRecorder(session, (failure) => failures.push(failure ?? "unknown"), {
      flock: () => {
        throw new Error("FFI unavailable");
      },
    });
    record({ taskId: "private", sessionFile: "/secret/path" });
    record({ taskId: "private-again" });
    expect(failures).toEqual(["locking"]);
    expect(existsSync(taskLifecycleFile(session))).toBe(true);
    expect(readFileSync(taskLifecycleFile(session), "utf8")).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compiled executable loads libc flock and writes a protected index", async () => {
  if (process.platform !== "linux" || process.arch !== "x64") return;
  const dir = mkdtempSync(join(tmpdir(), "die-lifecycle-compiled-"));
  try {
    const entry = join(dir, "entry.ts");
    const executable = join(dir, "lifecycle-smoke");
    const session = join(dir, "owner.jsonl");
    const modulePath = join(import.meta.dir, "../src/tasks/task-lifecycle.ts");
    writeFileSync(
      entry,
      "import {createTaskLifecycleRecorder} from " +
        JSON.stringify(modulePath) +
        ";createTaskLifecycleRecorder(process.argv[2],(failure)=>{console.error(failure);process.exitCode=2})({taskId:'compiled'});",
    );
    const build = Bun.spawn([process.execPath, "build", "--compile", entry, "--outfile", executable], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildExit, buildError] = await Promise.all([build.exited, new Response(build.stderr).text()]);
    expect(buildExit, buildError).toBe(0);
    const run = Bun.spawn([executable, session], { stdout: "pipe", stderr: "pipe" });
    const [runExit, runError] = await Promise.all([run.exited, new Response(run.stderr).text()]);
    expect(runExit, runError).toBe(0);
    expect(readFileSync(taskLifecycleFile(session), "utf8")).toBe('{"taskId":"compiled"}\n');
    expect(statSync(taskLifecycleFile(session)).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
