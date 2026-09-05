import { afterEach, describe, expect, test } from "bun:test";
import asynchronousTasksExtension from "../src/tasks/extension";

const originalDepth = process.env.DIE_SUBAGENT_DEPTH;

afterEach(() => {
  if (originalDepth === undefined) delete process.env.DIE_SUBAGENT_DEPTH;
  else process.env.DIE_SUBAGENT_DEPTH = originalDepth;
});

function loadExtension(depth?: string) {
  if (depth === undefined) delete process.env.DIE_SUBAGENT_DEPTH;
  else process.env.DIE_SUBAGENT_DEPTH = depth;

  const tools = new Map<string, any>();
  const handlers = new Map<string, (...args: any[]) => any>();
  let active = ["read", "write", "edit", "bash", "task", "subagent"];
  const statuses = new Map<string, string | undefined>();
  const notifications: any[] = [];
  const ui = {
    setStatus(key: string, value: string | undefined) {
      statuses.set(key, value);
    },
  };
  const pi = {
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    on(event: string, handler: (...args: any[]) => any) {
      handlers.set(event, handler);
    },
    getActiveTools() {
      return active;
    },
    setActiveTools(next: string[]) {
      active = next;
    },
    sendMessage(message: any) { notifications.push(message); },
  };
  asynchronousTasksExtension(pi as any);
  handlers.get("session_start")?.({}, {});
  return { tools, handlers, ui, statuses, notifications, active: () => active };
}

describe("sub-agent recursion guard", () => {
  test("root agents can use subagent", () => {
    const extension = loadExtension();
    expect(extension.active().sort()).toEqual(["execute", "subagent", "task"]);
    for (const replaced of ["read", "edit", "write", "bash"]) expect(extension.active()).not.toContain(replaced);
  });

  test("guidance explains required actions and yielding instead of no-op waiting", () => {
    const { tools } = loadExtension();
    const task = tools.get("task");
    expect(task.description).toContain("Every call requires action");
    expect(task.parameters.required).toContain("action");
    expect(task.promptGuidelines.join("\n")).toContain("end your turn without more tool calls");
    expect(tools.get("subagent").promptGuidelines.join("\n")).toContain("Ending the turn does not cancel background work");
    expect(tools.get("execute").promptGuidelines.join("\n")).toContain("Do not use execute for no-op calls");
  });

  test("spawn results remind the agent it can yield while work runs", async () => {
    const extension = loadExtension();
    try {
      for (const params of [{ action: "spawn", command: "printf one" }, { action: "spawn", commands: ["printf two", "printf three"] }]) {
        const result = await extension.tools.get("task").execute("spawn", params, undefined, undefined, { cwd: process.cwd() });
        expect(result.content[0].text).toContain("end your turn without more tool calls");
        expect(result.content[0].text).toContain("automatic completion will resume you");
      }
    } finally {
      extension.handlers.get("session_shutdown")?.({}, {});
    }
  });

  for (const mode of ["print", "json"]) {
    test(`${mode} idle boundary waits for one task and flushes its completion`, async () => {
      const extension = loadExtension();
      const task = extension.tools.get("task");
      try {
        const spawned = await task.execute("spawn", { action: "spawn", commands: ["read value; printf first", "sleep 30"] }, undefined, undefined, { cwd: process.cwd() });
        let ended = false;
        const boundary = extension.handlers.get("agent_end")!({ messages: [] }, { mode }).then(() => { ended = true; });
        await Bun.sleep(20);
        expect(ended).toBe(false);
        await task.execute("input", { action: "input", id: spawned.details.tasks[0].id, data: "go\n", closeInput: true }, undefined, undefined, {});
        await boundary;
        expect(extension.notifications).toHaveLength(1);
        expect(extension.notifications[0].content).toContain("first");
        const listing = await task.execute("list", { action: "list" }, undefined, undefined, {});
        expect(listing.details.tasks[1].status).toBe("running");
      } finally { extension.handlers.get("session_shutdown")?.({}, {}); }
    });
  }

  test("idle waiting leaves the TUI responsive and honors cancellation", async () => {
    const extension = loadExtension();
    try {
      await extension.tools.get("task").execute("spawn", { action: "spawn", command: "sleep 30" }, undefined, undefined, { cwd: process.cwd() });
      await extension.handlers.get("agent_end")!({ messages: [] }, { mode: "tui" });
      const controller = new AbortController();
      const boundary = extension.handlers.get("agent_end")!({ messages: [] }, { mode: "json", signal: controller.signal });
      controller.abort();
      await boundary;
      expect(extension.notifications).toHaveLength(0);
      await extension.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "error" }] }, { mode: "print" });
    } finally { extension.handlers.get("session_shutdown")?.({}, {}); }
  });

  test("first-level sub-agents can delegate one more level", () => {
    const extension = loadExtension("1");
    expect(extension.active().sort()).toEqual(["execute", "subagent", "task"]);
    for (const replaced of ["read", "edit", "write", "bash"]) expect(extension.active()).not.toContain(replaced);
  });

  test("second-level sub-agents are leaves", () => {
    const extension = loadExtension("2");
    expect(extension.active().sort()).toEqual(["execute", "task"]);
    expect(extension.active()).not.toContain("subagent");
  });

  test("delegation past the second level is rejected even if externally reactivated", async () => {
    const extension = loadExtension("2");
    const tool = extension.tools.get("subagent");
    await expect(tool.execute("call", { prompt: "recurse" }, undefined, undefined, {})).rejects.toThrow(
      "Sub-agent delegation is limited to 2 levels",
    );
  });

  test("task list is paginated and truncates long commands", async () => {
    const extension = loadExtension();
    const tool = extension.tools.get("task");
    const longCommand = `printf ok # ${"x".repeat(600)}`;
    await tool.execute("spawn", { action: "spawn", commands: [longCommand, "printf two", "printf three"] }, undefined, undefined, { cwd: process.cwd() });

    const first = await tool.execute("list", { action: "list", count: 2 }, undefined, undefined, {});
    expect(first.details.tasks).toHaveLength(2);
    expect(first.details.nextCursor).toBe(2);
    expect(first.content[0].text).toContain("Tasks 1-2 of 3; next cursor=2");
    expect(first.content[0].text).toContain("printf ok");
    expect(first.content[0].text).toContain("characters omitted");
    expect(first.content[0].text).toEndWith("printf two");
    expect(first.content[0].text.length).toBeLessThan(longCommand.length);

    const second = await tool.execute("list", { action: "list", cursor: 2, count: 2 }, undefined, undefined, {});
    expect(second.details.tasks).toHaveLength(1);
    expect(second.details.nextCursor).toBeUndefined();
    extension.handlers.get("session_shutdown")?.({}, {});
  });

  test("publishes and clears a persistent running-task status", async () => {
    const extension = loadExtension();
    const tool = extension.tools.get("task");
    await tool.execute("spawn", { action: "spawn", command: "sleep 30" }, undefined, undefined, {
      cwd: process.cwd(),
      ui: extension.ui,
    });

    expect(extension.statuses.get("die-tasks")).toBe("1 task running");
    extension.handlers.get("session_shutdown")?.({}, {});
    expect(extension.statuses.get("die-tasks")).toBeUndefined();
  });
});
