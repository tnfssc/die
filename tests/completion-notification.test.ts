import { describe, expect, test } from "bun:test";
import {
  formatCompletionNotification,
  MAX_COMPLETION_NOTIFICATION_CHARS,
} from "../src/tasks/completion-notification";
import type { TaskInspection } from "../src/tasks/task-manager";

function completedTask(index: number, output = `output-${index}`): TaskInspection {
  return {
    id: `task_${index}`,
    kind: "command",
    command: `command-${index}`,
    cwd: "/tmp",
    status: "completed",
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
    exitCode: 0,
    baseOffset: 0,
    outputEnd: Buffer.byteLength(output),
    timedOut: false,
    output,
    requestedOffset: 0,
    nextOffset: Buffer.byteLength(output),
    outputLost: false,
    hasMore: false,
  };
}

describe("completion notifications", () => {
  test("never exceed 5,000 characters", () => {
    const tasks = Array.from({ length: 50 }, (_, index) => completedTask(index, "x".repeat(2_000)));
    const notification = formatCompletionNotification(tasks);

    expect(notification.length).toBeLessThan(2_500);
    expect(notification.length).toBeLessThanOrEqual(MAX_COMPLETION_NOTIFICATION_CHARS);
    expect(notification).toContain("50 asynchronous tasks completed");
    expect(notification).toContain("Result previews:");
    expect(notification).toContain("additional completions omitted");
    expect(notification).toContain("jobs.inspect");
    for (const task of tasks) expect(notification).toContain(task.id);
  });

  test("makes shortened commands explicit and preserves both ends", () => {
    const task = completedTask(1);
    task.command = `begin-${"x".repeat(1_000)}-end`;
    const notification = formatCompletionNotification([task]);

    expect(notification).toContain("Command: begin-");
    expect(notification).toContain("characters omitted");
    expect(notification).toContain("-end");
    expect(notification.length).toBeLessThanOrEqual(MAX_COMPLETION_NOTIFICATION_CHARS);
  });

  test("includes complete summaries when the batch fits", () => {
    const notification = formatCompletionNotification([completedTask(1), completedTask(2)]);

    expect(notification).toContain("task_1 completed");
    expect(notification).toContain("output-1");
    expect(notification).toContain("task_2 completed");
    expect(notification).toContain("output-2");
    expect(notification).not.toContain("omitted");
  });
});

test("failed agent progress is not labeled as a successful final answer", () => {
  const task = completedTask(1, "Still waiting for workers");
  task.kind = "agent"; task.status = "killed"; task.timedOut = true;
  task.agent = { type: "orchestrator", depth: 1, model: "provider/model", sessionFile: "/tmp/session.jsonl" };
  const text = formatCompletionNotification([task]);
  expect(text).toContain("Diagnostic preview (last progress, not a final answer)");
  expect(text).not.toContain("Final output preview:");
});
