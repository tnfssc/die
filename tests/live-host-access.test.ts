import { expect, test } from "bun:test";
import tasksExtension from "../src/tasks/extension";
import { getLiveHost } from "../src/live-lab/host-access";

test("tasks extension exposes its real shared JobService/TaskManager and retains bridge until shutdown", async () => {
  const handlers = new Map<string, Function[]>();
  const sent: unknown[] = [];
  const pi = {
    registerTool() {}, registerCommand() {}, registerFlag() {}, registerMessageRenderer() {},
    getFlag: () => false, setActiveTools() {}, sendMessage() {},
    sendUserMessage: (...args: unknown[]) => sent.push(args),
    on: (name: string, fn: Function) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
  } as any;
  tasksExtension(pi);
  const sessionManager = { getSessionId: () => "host-test", getSessionFile: () => undefined, getEntries: () => [], getLeafId: () => null, getBranch: () => [] };
  const ctx = {
    sessionManager, mode: "print", cwd: process.cwd(), hasUI: false,
    ui: { setStatus() {}, notify() {}, confirm: async () => false },
    modelRegistry: { runtime: { streamSimple() {}, prepareRequest() {}, isUsingOAuth: () => false } },
    scopedModels: [], isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "base",
    hasPendingMessages: () => false,
  } as any;
  const fire = async (name: string, event: unknown = {}) => { for (const fn of handlers.get(name) ?? []) await fn(event, ctx); };
  await fire("session_start");
  const host = getLiveHost(pi, ctx)!;
  expect(host).toBeDefined();
  expect(getLiveHost(pi, ctx)).toBe(host);
  expect((await host.list() as { jobs: unknown[] }).jobs).toEqual([]);
  await host.send("request-1", "please work");
  await host.send("request-1", "please work");
  expect(sent).toEqual([["[voice request id: request-1]\nplease work", { deliverAs: "followUp", expandPromptTemplates: false }]]);
  expect(host.context().requests).toEqual([{ id: "request-1", operation: "followUp", state: "done" }]);
  const updates: string[] = [];
  host.subscribe(update => updates.push(update.type));
  await fire("message_end", { message: { role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "Finished coding" }] } });
  await fire("turn_end");
  expect(updates).toEqual(["assistant", "turn_end"]);
  await fire("session_shutdown");
  expect(getLiveHost(pi, ctx)).toBeUndefined();
  expect(() => host.context()).toThrow("scope changed");
});
