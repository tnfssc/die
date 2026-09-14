import { describe, expect, test } from "bun:test";
import type { TaskEvent, TaskSummary } from "../src/tasks/task-manager";
import { createWebTaskEventEmitter, webTaskEvent } from "../src/tasks/web-events";

function summary(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "task_fixture",
    kind: "agent",
    command: "work ".repeat(1_000),
    cwd: "/fixture",
    status: "running",
    startedAt: "2026-01-01T00:00:00Z",
    baseOffset: 0,
    outputEnd: 1_000_000,
    timedOut: false,
    agent: {
      type: "normal",
      model: "fixture/model",
      thinking: "medium",
      depth: 1,
      sessionFile: "/private/session.jsonl",
    },
    ...overrides,
  };
}

const spawned: TaskEvent = { type: "spawned", task: summary() };

describe("web task lifecycle events", () => {
  test("emits one bounded start/completion NDJSON record with only public fields", () => {
    const lines: string[] = [];
    const emit = createWebTaskEventEmitter("rpc", {
      env: { DIE_WEB_TASK_EVENTS: "1" },
      write: (line) => lines.push(line),
    });
    emit(spawned);
    emit({ type: "completed", task: summary({ status: "completed", completedAt: "2026-01-01T00:00:01Z" }) });

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.endsWith("\n"))).toBe(true);
    const [started, completed] = lines.map((line) => JSON.parse(line));
    expect(started).toMatchObject({
      type: "die_task_event",
      event: "started",
      task: {
        id: "task_fixture",
        kind: "agent",
        status: "running",
        agent: { type: "normal", model: "fixture/model", thinking: "medium" },
      },
    });
    expect(started.task.command).toHaveLength(240);
    expect(completed).toMatchObject({ event: "completed", task: { status: "completed" } });
    expect(lines.every((line) => line.length < 700)).toBe(true);
    expect(lines.join("")).not.toContain("/private");
    expect(lines.join("")).not.toContain("outputEnd");
  });

  test("flag-off RPC, TUI, and JSON modes produce no traffic", () => {
    for (const emit of [
      createWebTaskEventEmitter("rpc", {
        env: {},
        write: () => {
          throw new Error("wrote");
        },
      }),
      createWebTaskEventEmitter("tui", {
        env: { DIE_WEB_TASK_EVENTS: "1" },
        write: () => {
          throw new Error("wrote");
        },
      }),
      createWebTaskEventEmitter("json", {
        env: { DIE_WEB_TASK_EVENTS: "1" },
        write: () => {
          throw new Error("wrote");
        },
      }),
    ])
      emit(spawned);
  });

  test("activity and stopping events produce no traffic", () => {
    const lines: string[] = [];
    const emit = createWebTaskEventEmitter("rpc", {
      env: { DIE_WEB_TASK_EVENTS: "1" },
      write: (line) => lines.push(line),
    });
    emit({ type: "activity", task: spawned.task, source: "output" });
    emit({ type: "stopping", task: spawned.task });
    expect(lines).toEqual([]);
    expect(webTaskEvent({ type: "activity", task: spawned.task, source: "output" })).toBeUndefined();
  });
});
