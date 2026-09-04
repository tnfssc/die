import type { TaskInspection } from "./task-manager";

export const MAX_COMPLETION_NOTIFICATION_CHARS = 5_000;
const MAX_COMMAND_PREVIEW_CHARS = 500;
const MAX_OUTPUT_PREVIEW_CHARS = 1_000;

function tail(value: string, limit: number): string {
  return value.length <= limit ? value : `…${value.slice(-(limit - 1))}`;
}

function formatOmitted(tasks: TaskInspection[], limit: number): string {
  const heading = `${tasks.length} additional completion${tasks.length === 1 ? "" : "s"} omitted from this notification.`;
  const instruction = "Use task inspect with an ID below, or task list, to read retained output.";
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

export function formatCompletionNotification(tasks: TaskInspection[]): string {
  let content = `${tasks.length} asynchronous task${tasks.length === 1 ? "" : "s"} completed.`;

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const output = task.output.trim();
    const block = [
      `${task.id} ${task.status}`,
      `Command: ${tail(task.command, MAX_COMMAND_PREVIEW_CHARS)}`,
      task.exitCode !== undefined ? `Exit code: ${task.exitCode}` : undefined,
      task.signal ? `Signal: ${task.signal}` : undefined,
      task.timedOut ? "Timed out: yes" : undefined,
      output ? `Final output preview:\n${tail(output, MAX_OUTPUT_PREVIEW_CHARS)}` : "No output.",
    ]
      .filter(Boolean)
      .join("\n");
    const part = `\n\n${block}`;
    const futureOmitted = index < tasks.length - 1
      ? `\n\n${formatOmitted(tasks.slice(index + 1), MAX_COMPLETION_NOTIFICATION_CHARS)}`
      : "";

    if (content.length + part.length + futureOmitted.length > MAX_COMPLETION_NOTIFICATION_CHARS) {
      const available = MAX_COMPLETION_NOTIFICATION_CHARS - content.length - 2;
      if (available > 0) content += `\n\n${formatOmitted(tasks.slice(index), available)}`;
      break;
    }
    content += part;
  }

  return content.slice(0, MAX_COMPLETION_NOTIFICATION_CHARS);
}
