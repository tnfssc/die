import { EventEmitter } from "node:events";
import { expect, test } from "bun:test";
import liveLabExtension from "../src/live-lab/extension";
import { VoiceSession } from "../src/live-lab/session";
import type { LiveParams, LiveConnection, VoiceOrchestration } from "../src/live-lab/types";
import tasksExtension from "../src/tasks/extension";
import { getLiveHost } from "../src/live-lab/host-access";

test("tasks extension exposes its real shared JobService/TaskManager and retains bridge until shutdown", async () => {
  const handlers = new Map<string, Function[]>();
  const sent: unknown[] = [];
  const bus = new EventEmitter();
  const events = () => ({
    emit: (name: string, data: unknown) => {
      bus.emit(name, data);
    },
    on: (name: string, handler: (data: unknown) => void) => {
      bus.on(name, handler);
      return () => {
        bus.off(name, handler);
      };
    },
  });
  let voiceCommand!: (args: string, ctx: any) => Promise<void>;
  const voicePi = {
    events: events(),
    registerCommand: (_name: string, command: any) => {
      voiceCommand = command.handler;
    },
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
  await fire("session_start");
  const host = getLiveHost(voicePi, ctx)!;
  expect(host).toBeDefined();
  expect(getLiveHost(voicePi, ctx)).toBe(host);
  expect(((await host.list()) as { jobs: unknown[] }).jobs).toEqual([]);
  await host.send("request-1", "please work");
  await host.send("request-1", "please work");
  expect(sent).toEqual([
    ["[voice request id: request-1]\nplease work", { deliverAs: "followUp", expandPromptTemplates: false }],
  ]);
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
  // Real extension -> shared event bus -> existing tasks authority -> real VoiceSession seam.
  let sdk!: LiveParams;
  const contexts: unknown[] = [];
  const responses: unknown[] = [];
  let tools: VoiceOrchestration | undefined;
  liveLabExtension(voicePi, {
    local: () => true,
    key: async () => "fake-no-network",
    voice: (callbacks, orchestration) => {
      tools = orchestration;
      return new VoiceSession(
        callbacks,
        () => ({
          live: {
            connect: async (params) => {
              sdk = params;
              return {
                sendRealtimeInput() {},
                sendClientContent: (v: unknown) => contexts.push(v),
                sendToolResponse: (v: unknown) => responses.push(v),
                close() {},
              } as unknown as LiveConnection;
            },
          },
        }),
        orchestration,
      );
    },
    audio: async () => ({
      start: async () => {},
      play: async () => {},
      flush: async () => {},
      stop: async () => {},
      close() {},
      diagnostics: {} as any,
    }),
  });
  await voiceCommand("start", ctx);
  expect(tools?.tools.map((t) => t.name)).toContain("agent_steer");
  sdk.callbacks.onmessage({
    toolCall: {
      functionCalls: [{ id: "sdk-call", name: "agent_steer", args: { requestId: "request-2", text: "please adjust" } }],
    },
  } as any);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(sent.at(-1)).toEqual([
    "[voice request id: request-2]\nplease adjust",
    { deliverAs: "steer", expandPromptTemplates: false },
  ]);
  expect(responses).toContainEqual({
    functionResponses: {
      id: "sdk-call",
      name: "agent_steer",
      response: { output: { queued: true } },
      scheduling: "WHEN_IDLE",
    },
  });
  await fire("message_end", {
    message: { role: "assistant", content: [{ type: "text", text: "Actual configured-agent reply" }] },
  });
  expect(JSON.stringify(contexts)).toContain("Actual configured-agent reply");
  await voiceCommand("stop", ctx);
  expect(getLiveHost(voicePi, ctx)).toBe(host);
  await voiceCommand("start", ctx);
  await tools!.execute({ name: "agent_steer", args: { requestId: "request-2", text: "please adjust" } });
  expect(sent).toHaveLength(2);
  await voiceCommand("stop", ctx);
  await fire("session_shutdown");
  expect(getLiveHost(voicePi, ctx)).toBeUndefined();
  expect(() => host.context()).toThrow("scope changed");
});
