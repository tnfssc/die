import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  GOAL_ENTRY_TYPE,
  GoalStore,
  latestGoal,
} from "../src/goals/store";
import {
  GoalContinuationController,
  MAX_NO_PROGRESS_CONTINUATIONS,
} from "../src/goals/controller";
import { registerGoalMode } from "../src/goals/extension";

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
    expect(entries.every(entry => entry.customType === GOAL_ENTRY_TYPE)).toBe(true);
  });

  test("fails closed on corrupt, future, and obsolete updates", () => {
    const entries: any[] = [];
    const store = new GoalStore(
      (customType, data) => entries.push({ type: "custom", customType, data }),
    );
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
    expect(() => store.update(
      { status: "waiting", pendingJobIds: ["foreign"] },
      new Set(["mine"]),
    )).toThrow("owned");
    expect(store.update(
      { status: "waiting", pendingJobIds: ["mine"] },
      new Set(["mine"]),
    )).toMatchObject({ status: "waiting", pendingJobIds: ["mine"] });
  });
});

test("no-progress guard ignores revision bumps and tool activity", () => {
  const controller = new GoalContinuationController();
  let goal: any = { id: "g", status: "active", revision: 1 };
  expect(controller.settle(goal)).toBe("continue");

  for (let turn = 1; turn <= MAX_NO_PROGRESS_CONTINUATIONS; turn++) {
    controller.markAutomaticStart(goal);
    goal = { ...goal, revision: goal.revision + 1 };
    const expected = turn === MAX_NO_PROGRESS_CONTINUATIONS ? "pause" : "continue";
    expect(controller.settle(goal)).toBe(expected);
  }
});

function harness(entries: any[] = []) {
  const handlers: Record<string, Function[]> = {};
  const commands: Record<string, any> = {};
  const sent: string[] = [];
  const notices: any[] = [];
  const appended: any[] = [];
  const statuses = new Map<string, "running" | "finished" | "unavailable">([
    ["job_1", "running"],
  ]);
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
    runningIds: () => new Set([...statuses]
      .filter(([, status]) => status === "running")
      .map(([id]) => id)),
    status: id => statuses.get(id) ?? "unavailable",
  });
  const ctx: any = {
    sessionManager: {
      getBranch: () => entries,
      getEntries: () => { throw new Error("must restore only the active branch"); },
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

test("same-status helper revisions cannot evade the automatic-turn bound", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  h.handlers.agent_settled[0]({}, h.ctx);

  for (let turn = 0; turn < MAX_NO_PROGRESS_CONTINUATIONS; turn++) {
    h.runtime.handle("goal.update", { status: "active" });
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

  h.handlers.agent_settled[0]({}, h.ctx);
  expect(h.runtime.get()?.status).toBe("waiting");
  const result = h.handlers.before_agent_start[0]({ systemPrompt: "base" }, h.ctx);
  expect(h.runtime.get()?.status).toBe("active");
  expect(result.systemPrompt).toContain("Persistent goal state");
});

test("resumed waiting work that is no longer owned pauses visibly", () => {
  const original = harness();
  original.runtime.handle("goal.set", input);
  original.runtime.handle("goal.update", { status: "waiting", pendingJobIds: ["job_1"] });
  const resumed = harness(original.appended);
  resumed.statuses.clear();
  resumed.handlers.before_agent_start[0]({ systemPrompt: "base" }, resumed.ctx);
  expect(resumed.runtime.get()).toMatchObject({
    status: "paused",
    pauseReason: expect.stringContaining("unavailable"),
  });
});

test("slash command initializes before session_start and invalidates reminders", async () => {
  const h = harness();
  h.handlers.session_start.length = 0;
  await h.commands.goal.handler(
    "set Build it --criteria one; two --constraints stay offline",
    h.ctx,
  );
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

test("goal history is durable JSONL and branch scoped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-goal-jsonl-"));
  try {
    let manager = SessionManager.create(dir, join(dir, "sessions"));
    const initialFile = manager.getSessionFile()!;
    await writeFile(initialFile, JSON.stringify(manager.getHeader()) + "\n", { flag: "wx" });
    manager = SessionManager.open(initialFile);
    manager.appendMessage({ role: "user", content: "start", timestamp: 1 });
    const store = new GoalStore(
      (type, data) => manager.appendCustomEntry(type, data),
      manager.getBranch(),
    );
    store.set(input);
    const activeLeaf = manager.getLeafId()!;
    store.clear();
    expect(latestGoal(manager.getBranch())).toBeUndefined();

    manager.branch(activeLeaf);
    expect(latestGoal(manager.getBranch())?.objective).toBe(input.objective);
    expect(latestGoal(manager.getEntries())).toBeUndefined();

    const file = manager.getSessionFile()!;
    expect((await Bun.file(file).text()).trim().split("\n").every(line => {
      JSON.parse(line);
      return true;
    })).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
