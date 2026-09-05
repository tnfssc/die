import type { TaskInspection } from "./task-manager";
import { boundedMiddlePreview } from "./text-preview";

export const MAX_COMPLETION_NOTIFICATION_CHARS = 5_000;
const MAX_COMMAND_PREVIEW_CHARS = 160;
const MAX_OUTPUT_PREVIEW_CHARS = 1_000;
const LARGE_BATCH_THRESHOLD = 10;
const LARGE_BATCH_PREVIEW_COUNT = 5;
const LARGE_BATCH_OUTPUT_CHARS = 80;

function tail(value: string, limit: number): string {
  return value.length <= limit ? value : `…${value.slice(-(limit - 1))}`;
}

function formatOmitted(tasks: TaskInspection[], limit: number): string {
  const heading = `${tasks.length} additional completion${tasks.length === 1 ? "" : "s"} omitted from this notification.`;
  const instruction = "Use execute with jobs.inspect(id) or jobs.list() to read retained output.";
  if (limit <= heading.length) return heading.slice(0, limit);

  let result = `${heading}\nIDs:`;
  let included = 0;
  for (const task of tasks) {
    const candidate = `${result} ${task.id}`;
    const remaining = tasks.length - included - 1;
    const suffix = remaining > 0 ? ` … (+${remaining} more)` : "";
    if (candidate.length + suffix.length + 1 + instruction.length > limit) break;
    result = candidate;
    included++;
  }
  if (included < tasks.length) result += ` … (+${tasks.length - included} more)`;
  if (result.length + 1 + instruction.length <= limit) result += `\n${instruction}`;
  return result.slice(0, limit);
}

function formatLargeBatch(tasks: TaskInspection[], maxChars: number): string {
  let content = `${tasks.length} asynchronous tasks completed.\n\nResult previews:`;
  for (const task of tasks.slice(0, LARGE_BATCH_PREVIEW_COUNT)) {
    const output = task.output.trim().replaceAll(/\s+/g, " ");
    const exit = task.exitCode !== undefined ? ` exit=${task.exitCode}` : task.signal ? ` signal=${task.signal}` : "";
    content += `\n${task.id} ${task.status}${exit}${output ? ` — ${tail(output, LARGE_BATCH_OUTPUT_CHARS)}` : ""}`;
  }
  const omitted = tasks.slice(LARGE_BATCH_PREVIEW_COUNT);
  if (omitted.length > 0) {
    const available = maxChars - content.length - 2;
    content += `\n\n${formatOmitted(omitted, available)}`;
  }
  return content.slice(0, maxChars);
}

export function formatCompletionNotification(
  tasks: TaskInspection[],
  maxChars = MAX_COMPLETION_NOTIFICATION_CHARS,
): string {
  if (tasks.length > LARGE_BATCH_THRESHOLD) return formatLargeBatch(tasks, maxChars);
  let content = `${tasks.length} asynchronous task${tasks.length === 1 ? "" : "s"} completed.`;

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const output = task.output.trim();
    const block = [
      `${task.id} ${task.status}`,
      `Command: ${boundedMiddlePreview(task.command, MAX_COMMAND_PREVIEW_CHARS)}`,
      task.exitCode !== undefined ? `Exit code: ${task.exitCode}` : undefined,
      task.signal ? `Signal: ${task.signal}` : undefined,
      task.timedOut ? "Timed out: yes" : undefined,
      task.agent ? `Session: ${boundedMiddlePreview(task.agent.sessionFile, 400)}` : undefined,
      output
        ? `${task.agent && task.status !== "completed" ? "Diagnostic preview (last progress, not a final answer)" : "Final output preview"}:\n${tail(output, MAX_OUTPUT_PREVIEW_CHARS)}`
        : "No output.",
    ]
      .filter(Boolean)
      .join("\n");
    const part = `\n\n${block}`;
    const futureOmitted = index < tasks.length - 1 ? `\n\n${formatOmitted(tasks.slice(index + 1), maxChars)}` : "";

    if (content.length + part.length + futureOmitted.length > maxChars) {
      const available = maxChars - content.length - 2;
      if (available > 0) content += `\n\n${formatOmitted(tasks.slice(index), available)}`;
      break;
    }
    content += part;
  }

  return content.slice(0, maxChars);
}
