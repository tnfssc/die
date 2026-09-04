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
    sendMessage() {},
  };
  asynchronousTasksExtension(pi as any);
  handlers.get("session_start")?.({}, {});
  return { tools, handlers, ui, statuses, active: () => active };
}

describe("sub-agent recursion guard", () => {
  test("root agents can use subagent", () => {
    const extension = loadExtension();
    expect(extension.active().sort()).toEqual(["execute", "subagent", "task"]);
    for (const replaced of ["read", "edit", "write", "bash"]) expect(extension.active()).not.toContain(replaced);
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
