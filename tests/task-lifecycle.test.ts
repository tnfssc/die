import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
