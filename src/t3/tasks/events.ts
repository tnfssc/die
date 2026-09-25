import { writeSync } from "node:fs";
import type { TaskEvent } from "../../tasks/task-manager";

const COMMAND_LIMIT = 240;
const AGENT_TYPE_LIMIT = 80;
const MODEL_LIMIT = 160;
const THINKING_LIMIT = 80;

export interface WebTaskEventRecord {
  type: "die_task_event";
  event: "started" | "completed";
  task: {
    id: string;
    kind: "command" | "agent";
    status: "running" | "completed" | "failed" | "killed";
    command: string;
    agent?: { type: string; model: string; thinking?: string };
  };
}

/** Format the small lifecycle-only record consumed by the web RPC adapter. */
export function webTaskEvent(event: TaskEvent): WebTaskEventRecord | undefined {
  if (event.type !== "spawned" && event.type !== "completed") return;
  const task = event.task;
  return {
    type: "die_task_event",
    event: event.type === "spawned" ? "started" : "completed",
    task: {
      id: task.id,
      kind: task.kind,
      status: task.status,
      command: task.command.slice(0, COMMAND_LIMIT),
      ...(task.agent
        ? {
            agent: {
              type: task.agent.type.slice(0, AGENT_TYPE_LIMIT),
              model: task.agent.model.slice(0, MODEL_LIMIT),
              ...(task.agent.thinking ? { thinking: task.agent.thinking.slice(0, THINKING_LIMIT) } : {}),
            },
          }
        : {}),
    },
  };
}

/** Raw NDJSON transport listener; it never sends a model message or persists output. */
export function createWebTaskEventEmitter(
  mode: string | undefined,
  options: {
    env?: { DIE_WEB_TASK_EVENTS?: string };
    write?: (line: string) => unknown;
  } = {},
): (event: TaskEvent) => void {
  if (mode !== "rpc" || (options.env ?? process.env).DIE_WEB_TASK_EVENTS !== "1") return () => {};
  // Pi guards process.stdout.write in RPC mode; these opted-in protocol records
  // must go directly to the same NDJSON transport, not through the console guard.
  const write = options.write ?? ((line: string) => writeSync(1, line));
  return (event) => {
    const record = webTaskEvent(event);
    if (!record) return;
    try {
      write(`${JSON.stringify(record)}\n`);
    } catch {
      // Transport notices must never affect task execution.
    }
  };
}
