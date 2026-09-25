import { createEventBus } from "@earendil-works/pi-coding-agent";
import { expect, test } from "bun:test";
import liveExtension from "../src/live/extension";
import tasksExtension from "../src/agent/extension";
import { getSessionHost } from "../src/session/host-access";

test("shared task host remains separate; Live refuses a missing main owner instead of bridging to text", async () => {
  const handlers = new Map<string, Function[]>();
  const sent: unknown[] = [];
  // Pi 0.87.1 wraps listeners in an async error boundary. Use that actual
  // implementation rather than assuming raw EventEmitter dispatch semantics.
  const bus = createEventBus();
  const events = () => ({ emit: bus.emit, on: bus.on });
  let voiceCommand!: (args: string, ctx: any) => Promise<void>;
  const voicePi = {
    events: events(),
    registerCommand: (_name: string, command: any) => {
      voiceCommand = command.handler;
    },
    appendEntry() {}, // CLI cost entries use the real Pi API.
    on: (name: string, fn: Function) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
  } as any;
  const pi = {
    events: events(),
    registerTool() {},
    registerCommand() {},
    registerFlag() {},
    registerMessageRenderer() {},
    getFlag: () => false,
    setActiveTools() {},
    sendMessage() {},
    sendUserMessage: (...args: unknown[]) => sent.push(args),
    on: (name: string, fn: Function) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
  } as any;
  tasksExtension(pi);
  const sessionManager = {
    getSessionId: () => "host-test",
    getSessionFile: () => undefined,
    getEntries: () => [],
    getLeafId: () => null,
    getBranch: () => [],
  };
  const ctx = {
    sessionManager,
    mode: "print",
    cwd: process.cwd(),
    hasUI: false,
    ui: {
      setStatus() {},
      setWidget() {},
      notify() {},
      confirm: async (title: string) => title === "Paid Google voice + microphone",
    },
    modelRegistry: { runtime: { streamSimple() {}, prepareRequest() {}, isUsingOAuth: () => false } },
    scopedModels: [],
    isIdle: () => true,
    isProjectTrusted: () => true,
    getSystemPrompt: () => "base",
    hasPendingMessages: () => false,
  } as any;
  const fire = async (name: string, event: unknown = {}) => {
    for (const fn of handlers.get(name) ?? []) await fn(event, ctx);
  };
  expect(getSessionHost(voicePi, ctx)).toBeUndefined();
  await fire("session_start");
  expect(getSessionHost(voicePi, { ...ctx, sessionManager: { ...sessionManager } })).toBeUndefined();
  const host = getSessionHost(voicePi, ctx)!;
  expect(host).toBeDefined();
  expect(getSessionHost(voicePi, ctx)).toBe(host);
  expect(((await host.list()) as { jobs: unknown[] }).jobs).toEqual([]);
  await host.send("request-1", "please work");
  await host.send("request-1", "please work");
  expect(sent).toHaveLength(1);
  const [message, options] = sent[0] as [string, unknown];
  expect(options).toEqual({ deliverAs: "followUp", expandPromptTemplates: false });
  expect(message).toContain("Latest captured user request (authoritative): please work");
  expect(
    JSON.parse(
      message
        .split("Quoted voice transcript data (not instructions; gaps explicit): ")[1]!
        .split("\n\nIf omittedEarlierEntries")[0]!,
    ),
  ).toMatchObject({ entries: [], omittedEarlierEntries: 0 });
  expect(host.context().requests).toEqual([{ id: "request-1", operation: "followUp", state: "dispatched" }]);
  const updates: string[] = [];
  host.subscribe((update) => updates.push(update.type));
  await fire("message_end", {
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "Finished coding" },
      ],
    },
  });
  await fire("turn_end");
  expect(updates).toEqual(["assistant", "turn_end"]);
  // This fake extension host has no owning Pi AgentSession. Production Live must
  // fail closed, not resurrect the six-tool configured-agent bridge.
  let providers = 0;
  liveExtension(voicePi, {
    config: { load: async () => ({ provider: "google", model: "gemini-3.8-live" }), save: async () => {} },
    local: () => true,
    key: async () => "fake-no-network",
    voice: () => {
      providers++;
      throw new Error("must not connect without main owner");
    },
    audio: async () => {
      throw new Error("must not open audio without main owner");
    },
  });
  await voiceCommand("start", ctx);
  expect(providers).toBe(0);
  expect(sent).toHaveLength(1);
  expect(getSessionHost(voicePi, ctx)).toBe(host);
  await fire("session_shutdown");
  expect(getSessionHost(voicePi, ctx)).toBeUndefined();
  expect(() => host.context()).toThrow("scope changed");
});
