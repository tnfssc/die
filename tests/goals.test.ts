import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { inspectDiagnostics } from "../src/diagnostics";
import { GoalContinuationController, MAX_NO_PROGRESS_CONTINUATIONS } from "../src/goals/controller";
import { registerGoalMode } from "../src/goals/extension";
import { GOAL_ENTRY_TYPE, GoalStore, latestGoal } from "../src/goals/store";

const input = {
  objective: "Ship goal mode",
  criteria: ["tests pass", "state persists"],
  constraints: ["no installs"],
};

describe("goal durable state", () => {
  test("requires fields and replays validated append-only entries", () => {
    const entries: any[] = [];
    let tick = 0;
    const store = new GoalStore(
      (customType, data) => entries.push({ type: "custom", customType, data }),
      [],
      () => `t${++tick}`,
    );

    expect(() => store.set({ ...input, criteria: [] })).toThrow("criteria is required");
    const active = store.set(input);
    expect(active).toMatchObject({ ...input, status: "active", revision: 1 });
    expect(latestGoal(entries)).toEqual(active);
    expect(() => store.update({ status: "completed" })).toThrow("completion evidence");
    expect(() => store.update({ status: "blocked" })).toThrow("blocker explanation");

    const done = store.update({ status: "completed", evidence: "bun test: 42 pass" });
    expect(new GoalStore(() => {}, entries).get()).toEqual(done);
    store.clear();
    expect(latestGoal(entries)).toBeUndefined();
    expect(entries.every((entry) => entry.customType === GOAL_ENTRY_TYPE)).toBe(true);
  });

  test("fails closed on corrupt, future, and obsolete updates", () => {
    const entries: any[] = [];
    const store = new GoalStore((customType, data) => entries.push({ type: "custom", customType, data }));
    const active = store.set(input);

    entries.push({
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: { version: 99, operation: "update", goal: active, at: "later" },
    });
    expect(latestGoal(entries)).toBeUndefined();

    entries.push({
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: { version: 1, operation: "update", goal: active, at: "latest" },
    });
    expect(latestGoal(entries)).toBeUndefined();
  });

  test("corrupt restore reports affected waiting job references", () => {
    const entries: any[] = [];
    const store = new GoalStore((customType, data) => entries.push({ type: "custom", customType, data }));
    store.set(input);
    store.update({ status: "waiting", pendingJobIds: ["task_owned"] }, new Set(["task_owned"]));
    entries.push({ type: "custom", customType: GOAL_ENTRY_TYPE, data: { version: 99 } });
    const owner = {};
    expect(latestGoal(entries, owner)).toBeUndefined();
    expect(inspectDiagnostics(owner).records).toContainEqual({
      version: 1,
      generated: expect.any(String),
      component: "resume",
      code: "state_invalid",
      outcome: "fallback",
      taskId: "task_owned",
    });
  });

  test("does not mutate memory when durable append fails", () => {
    let fail = false;
    const store = new GoalStore(() => {
      if (fail) throw new Error("disk full");
    });
    const active = store.set(input);
    fail = true;
    expect(() => store.update({ status: "paused", reason: "later" })).toThrow("disk full");
    expect(store.get()).toEqual(active);
    expect(() => store.clear()).toThrow("disk full");
    expect(store.get()).toEqual(active);
  });

  test("waiting accepts only currently owned running jobs", () => {
    const store = new GoalStore(() => {});
    store.set(input);
    expect(() => store.update({ status: "waiting", pendingJobIds: ["foreign"] }, new Set(["mine"]))).toThrow("owned");
    expect(store.update({ status: "waiting", pendingJobIds: ["mine"] }, new Set(["mine"]))).toMatchObject({
      status: "waiting",
      pendingJobIds: ["mine"],
    });
  });
});

test("no-progress guard counts each run and ignores revision bumps", () => {
  const controller = new GoalContinuationController();
  let goal: any = { id: "g", status: "active", revision: 1 };
  expect(controller.settle(goal)).toBe("continue");
  controller.markAutomaticStart(goal);

  for (let turn = 1; turn <= MAX_NO_PROGRESS_CONTINUATIONS; turn++) {
    goal = { ...goal, revision: goal.revision + 1 };
    const expected = turn === MAX_NO_PROGRESS_CONTINUATIONS ? "pause" : "none";
    expect(controller.endRun(goal)).toBe(expected);
    expect(controller.settle(goal)).toBe("continue");
  }
});

test("explicit progress resets the guard once, while repeated evidence does not", () => {
  const controller = new GoalContinuationController();
  let goal: any = { id: "g", status: "active", revision: 1, progress: [] };
  controller.markAutomaticStart(goal);
  goal = { ...goal, revision: 2, progress: ["verified parser test"] };
  expect(controller.endRun(goal)).toBe("none");
  for (let turn = 0; turn < MAX_NO_PROGRESS_CONTINUATIONS; turn++) {
    goal = { ...goal, revision: goal.revision + 1, progress: ["verified parser test"] };
    expect(controller.endRun(goal)).toBe(turn === MAX_NO_PROGRESS_CONTINUATIONS - 1 ? "pause" : "none");
  }
});

test("active progress is bounded and duplicate milestones are idempotent", () => {
  const store = new GoalStore(() => {});
  store.set(input);
  store.update({ status: "active", progress: "same evidence" });
  store.update({ status: "active", progress: "same evidence" });
  expect(store.get()?.progress).toEqual(["same evidence"]);
  for (let i = 0; i < 12; i++) store.update({ status: "active", progress: "milestone " + i });
  expect(store.get()?.progress).toHaveLength(8);
  expect(() => store.update({ status: "active", progress: "x".repeat(501) })).toThrow("too long");
});

function harness(entries: any[] = []) {
  const handlers: Record<string, Function[]> = {};
  const commands: Record<string, any> = {};
  const sent: string[] = [];
  const notices: any[] = [];
  const appended: any[] = [];
  const statuses = new Map<string, "running" | "finished" | "unavailable">([["job_1", "running"]]);
  const pi: any = {
    on(name: string, handler: Function) {
      (handlers[name] ??= []).push(handler);
    },
    registerCommand(name: string, options: any) {
      commands[name] = options;
    },
    appendEntry(customType: string, data: any) {
      appended.push({ type: "custom", customType, data });
    },
    sendUserMessage(message: string) {
      sent.push(message);
    },
  };
  const runtime = registerGoalMode(pi, {
    runningIds: () => new Set([...statuses].filter(([, status]) => status === "running").map(([id]) => id)),
    status: (id) => statuses.get(id) ?? "unavailable",
  });
  const ctx: any = {
    sessionManager: {
      getBranch: () => entries,
      getEntries: () => {
        throw new Error("must restore only the active branch");
      },
    },
    ui: { notify: (...args: any[]) => notices.push(args) },
    hasPendingMessages: () => false,
    isIdle: () => false,
  };
  handlers.session_start[0]({}, ctx);
  return { handlers, commands, sent, notices, appended, runtime, ctx, statuses };
}

test("only active goals continue and waiting interruption pauses", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  expect(() => h.runtime.handle("goal.update", { status: "completed" })).toThrow();
  h.handlers.agent_settled[0]({}, h.ctx);
  expect(h.sent).toHaveLength(1);

  h.runtime.handle("goal.update", { status: "waiting", pendingJobIds: ["job_1"] });
  h.handlers.agent_settled[0]({}, h.ctx);
  expect(h.sent).toHaveLength(1);
  h.handlers.input[0]({ source: "interactive", streamingBehavior: "steer" }, h.ctx);
  expect(h.runtime.get()).toMatchObject({
    status: "paused",
    pauseReason: "Paused by user interruption",
  });
});

test("successful execute handoff waits only when owned work is running", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  const handoff = {
    toolName: "execute",
    isError: false,
    result: { details: { handoff: "Waiting for owned work" } },
  };
  h.handlers.tool_execution_end[0](handoff, h.ctx);
  expect(h.runtime.get()).toMatchObject({ status: "waiting", pendingJobIds: ["job_1"] });

  h.runtime.handle("goal.update", { status: "paused", reason: "deliberate" });
  h.handlers.tool_execution_end[0](handoff, h.ctx);
  expect(h.runtime.get()?.status).toBe("paused");

  const empty = harness();
  empty.runtime.handle("goal.set", input);
  empty.statuses.clear();
  empty.handlers.tool_execution_end[0](handoff, empty.ctx);
  expect(empty.runtime.get()?.status).toBe("active");
});

test("helper-created goal bounds repeated direct handoff completion cycles", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  const handoff = {
    toolName: "execute",
    isError: false,
    result: { details: { handoff: "Waiting after custom completion" } },
  };

  // No slash-start or initial reminder occurs before the helper's first
  // direct handoff. Job completions then trigger custom continuation turns.
  expect(h.sent).toHaveLength(0);
  for (let turn = 0; turn < MAX_NO_PROGRESS_CONTINUATIONS; turn++) {
    h.statuses.set("job_1", "running");
    h.handlers.tool_execution_end[0](handoff, h.ctx);
    h.handlers.agent_end[0]({ messages: [{ role: "assistant", stopReason: "toolUse" }] }, h.ctx);
    h.handlers.agent_settled[0]({}, h.ctx);
    if (turn < MAX_NO_PROGRESS_CONTINUATIONS - 1) {
      expect(h.runtime.get()?.status).toBe("waiting");
      h.statuses.set("job_1", "finished");
      h.runtime.jobsChanged();
      expect(h.runtime.get()?.status).toBe("active");
    }
  }
  expect(h.sent).toHaveLength(0);
  expect(h.runtime.get()).toMatchObject({
    status: "paused",
    pauseReason: expect.stringContaining("no meaningful progress"),
  });
});

test("failed-job waiting and completion turns retain the no-progress bound", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  h.handlers.agent_end[0]({ messages: [{ role: "assistant", stopReason: "stop" }] }, h.ctx);
  h.handlers.agent_settled[0]({}, h.ctx);
  const handoff = {
    toolName: "execute",
    isError: false,
    result: { details: { handoff: "Retrying through owned work" } },
  };

  for (let turn = 0; turn < MAX_NO_PROGRESS_CONTINUATIONS; turn++) {
    h.statuses.set("job_1", "running");
    h.handlers.tool_execution_end[0](handoff, h.ctx);
    h.handlers.agent_end[0]({ messages: [{ role: "assistant", stopReason: "toolUse" }] }, h.ctx);
    h.handlers.agent_settled[0]({}, h.ctx);
    if (turn < MAX_NO_PROGRESS_CONTINUATIONS - 1) {
      h.statuses.set("job_1", "finished");
      h.runtime.jobsChanged();
      expect(h.runtime.get()?.status).toBe("active");
    }
  }
  expect(h.runtime.get()).toMatchObject({
    status: "paused",
    pauseReason: expect.stringContaining("no meaningful progress"),
  });
});

test("distinct explicit milestones sustain repeated waiting completion turns", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  h.handlers.agent_end[0]({ messages: [{ role: "assistant", stopReason: "stop" }] }, h.ctx);
  h.handlers.agent_settled[0]({}, h.ctx);
  const handoff = {
    toolName: "execute",
    isError: false,
    result: { details: { handoff: "Continuing owned work" } },
  };

  for (let turn = 0; turn < MAX_NO_PROGRESS_CONTINUATIONS + 2; turn++) {
    h.runtime.handle("goal.update", { status: "active", progress: `verified milestone ${turn}` });
    h.statuses.set("job_1", "running");
    h.handlers.tool_execution_end[0](handoff, h.ctx);
    h.handlers.agent_end[0]({ messages: [{ role: "assistant", stopReason: "toolUse" }] }, h.ctx);
    h.handlers.agent_settled[0]({}, h.ctx);
    expect(h.runtime.get()?.status).toBe("waiting");
    h.statuses.set("job_1", "finished");
    h.runtime.jobsChanged();
  }
  expect(h.runtime.get()?.status).toBe("active");
});

test("same-status helper revisions cannot evade the automatic-turn bound", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  h.handlers.agent_end[0]({ messages: [{ role: "assistant", stopReason: "stop" }] }, h.ctx);
  h.handlers.agent_settled[0]({}, h.ctx);

  for (let turn = 0; turn < MAX_NO_PROGRESS_CONTINUATIONS; turn++) {
    h.runtime.handle("goal.update", { status: "active" });
    h.handlers.agent_end[0]({ messages: [{ role: "assistant", stopReason: "toolUse" }] }, h.ctx);
    h.handlers.agent_settled[0]({}, h.ctx);
  }
  expect(h.runtime.get()).toMatchObject({
    status: "paused",
    pauseReason: expect.stringContaining("no meaningful progress"),
  });
});

test("notifications do not impersonate queued user input", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  h.ctx.hasPendingMessages = () => true;
  h.handlers.agent_settled[0]({}, h.ctx);
  expect(h.runtime.get()?.status).toBe("active");
  expect(h.sent).toHaveLength(1);
});

test("waiting job completion reactivates at the next turn boundary", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  h.runtime.handle("goal.update", { status: "waiting", pendingJobIds: ["job_1"] });
  h.statuses.set("job_1", "finished");
  h.runtime.jobsChanged();

  expect(h.runtime.get()?.status).toBe("active");
  const result = h.handlers.context[0]({ messages: [] }, h.ctx);
  expect(result.messages.at(-1).content).toContain("Persistent goal state");
  expect(result.messages.at(-1).content).toContain("Status: active");
});

test("resumed waiting work that is no longer owned pauses visibly", () => {
  const original = harness();
  original.runtime.handle("goal.set", input);
  original.runtime.handle("goal.update", { status: "waiting", pendingJobIds: ["job_1"] });
  const resumed = harness(original.appended);
  resumed.statuses.clear();
  resumed.handlers.context[0]({ messages: [] }, resumed.ctx);
  expect(resumed.runtime.get()).toMatchObject({
    status: "paused",
    pauseReason: expect.stringContaining("unavailable"),
  });
});

test("continuation relies on the assembled authoritative state without duplicating it", async () => {
  const h = harness();
  const objective = "Keep {{criteria}}, " + "$&" + " and " + "$$" + " literal";
  const criterion = "preserve {{constraints}} and " + "$'" + " exactly";
  await h.commands.goal.handler("set " + objective + " --criteria " + criterion + " --constraints no rewrite", h.ctx);
  const reminder = h.sent.at(-1)!;
  expect(reminder).toContain("new automatic turn");
  expect(reminder).not.toContain(objective);
  expect(reminder).not.toContain(criterion);
  expect(reminder).not.toContain("Progress discipline");

  const assembled = h.handlers.context[0]({ messages: [{ role: "user", content: reminder }] }, h.ctx);
  const state = assembled.messages.at(-1).content;
  expect(state).toContain(objective);
  expect(state).toContain(criterion);
  expect(state).toContain("Constraints: no rewrite");
});

test("slash command initializes before session_start and invalidates reminders", async () => {
  const h = harness();
  h.handlers.session_start.length = 0;
  await h.commands.goal.handler("set Build it --criteria one; two --constraints stay offline", h.ctx);
  expect(h.runtime.get()).toMatchObject({
    objective: "Build it",
    criteria: ["one", "two"],
  });
  const reminder = h.sent.at(-1)!;
  await h.commands.goal.handler("clear", h.ctx);
  expect(h.handlers.input[0]({ source: "extension", text: reminder }, h.ctx)).toEqual({
    action: "handled",
  });
});

test("runtime refreshes goal state after same-manager branch navigation", () => {
  const handlers: Record<string, Function[]> = {};
  let leaf = "a";
  const branches: Record<string, any[]> = { a: [], b: [] };
  const manager = {
    getLeafId: () => leaf,
    getBranch: () => branches[leaf]!,
    getEntries: () => branches[leaf]!,
  };
  const pi: any = {
    on: (name: string, handler: Function) => (handlers[name] ??= []).push(handler),
    registerCommand() {},
    sendUserMessage() {},
    appendEntry(customType: string, data: any) {
      branches[leaf]!.push({ type: "custom", customType, data });
      leaf += ".next";
      branches[leaf] = [...branches[leaf.split(".next")[0]!]!];
    },
  };
  const runtime = registerGoalMode(pi, { runningIds: () => new Set(), status: () => "unavailable" });
  const ctx: any = { sessionManager: manager, ui: { notify() {} } };
  handlers.session_start[0]({}, ctx);
  runtime.handle("goal.set", input);
  expect(runtime.get()?.objective).toBe(input.objective);
  leaf = "b";
  expect(runtime.get()).toBeUndefined();
});

test("goal history is durable JSONL and branch scoped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-goal-jsonl-"));
  try {
    let manager = SessionManager.create(dir, join(dir, "sessions"));
    const initialFile = manager.getSessionFile()!;
    await writeFile(initialFile, JSON.stringify(manager.getHeader()) + "\n", { flag: "wx" });
    manager = SessionManager.open(initialFile);
    manager.appendMessage({ role: "user", content: "start", timestamp: 1 });
    const store = new GoalStore((type, data) => manager.appendCustomEntry(type, data), manager.getBranch());
    store.set(input);
    const activeLeaf = manager.getLeafId()!;
    store.clear();
    expect(latestGoal(manager.getBranch())).toBeUndefined();

    manager.branch(activeLeaf);
    expect(latestGoal(manager.getBranch())?.objective).toBe(input.objective);
    expect(latestGoal(manager.getEntries())).toBeUndefined();

    const file = manager.getSessionFile()!;
    expect(
      (await Bun.file(file).text())
        .trim()
        .split("\n")
        .every((line) => {
          JSON.parse(line);
          return true;
        }),
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resumed waiting goal preserves all affected task references in pause explanation", () => {
  const original = harness();
  const ids = ["task_abc123", "task_def456"];
  for (const id of ids) original.statuses.set(id, "running");
  original.runtime.handle("goal.set", input);
  original.runtime.handle("goal.update", { status: "waiting", pendingJobIds: ids });
  const resumed = harness(original.appended);
  resumed.statuses.clear();
  resumed.handlers.context[0]({ messages: [] }, resumed.ctx);
  expect(resumed.runtime.get()?.status).toBe("paused");
  for (const id of ids) expect(resumed.runtime.get()?.pauseReason).toContain(id);
});
