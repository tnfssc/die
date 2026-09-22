import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerProjectWisdom } from "../src/wisdom/extension";

function fixture(root = true) {
  const commands = new Map<
    string,
    { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }
  >();
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => any>>();
  const notices: Array<{ message: string; severity?: string }> = [];
  const ctx = {
    cwd: "/repo",
    ui: { notify: (message: string, severity?: string) => notices.push({ message, severity }) },
  } as unknown as ExtensionContext;
  const pi = {
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    on(name: string, handler: any) {
      const existing = handlers.get(name) ?? [];
      existing.push(handler);
      handlers.set(name, existing);
    },
  } as any;
  const runtime = registerProjectWisdom(pi, { isRoot: () => root });
  return { commands, handlers, notices, ctx, runtime };
}

describe("project wisdom extension", () => {
  test("injects vetted wisdom guidance for root agents", () => {
    const f = fixture(true);
    const result = f.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, f.ctx);
    expect(result.systemPrompt).toContain("Next agent not hear whole talk.");
    expect(result.systemPrompt).toContain("Leave code and wisdom together");
    expect(result.systemPrompt).toContain("Project wisdom lives in wisdom/.");
    expect(result.systemPrompt).toContain("Put it with the feature or system it explains.");
    expect(result.systemPrompt).not.toContain(".agents/notes");
    expect(result.systemPrompt).not.toContain("pending");
    expect(result.systemPrompt).not.toContain("index.md");
  });

  test("does not inject wisdom guidance into child agents", () => {
    const f = fixture(false);
    expect(f.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, f.ctx)).toBeUndefined();
  });

  test("/wisdom reports the durable location", async () => {
    const f = fixture(true);
    await f.commands.get("wisdom")!.handler("", f.ctx);
    expect(f.notices.at(-1)).toEqual({
      message: "Project wisdom lives in wisdom/. Put it with the feature or system it explains.",
      severity: undefined,
    });
  });

  test("/wisdom is root-only", async () => {
    const f = fixture(false);
    await f.commands.get("wisdom")!.handler("", f.ctx);
    expect(f.notices.at(-1)).toEqual({
      message: "Project wisdom is unavailable outside the root agent.",
      severity: "warning",
    });
  });

  test("jobsChanged is kept as a no-op integration hook", async () => {
    await expect(fixture().runtime.jobsChanged()).resolves.toBeUndefined();
  });
});
