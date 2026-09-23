import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type CurrentSessionEvent, createCurrentSessionBridge, type LiveBridgeEvent } from "../src/live/bridge";

class FakePi {
  readonly handlers = new Map<string, Set<(event: any) => void>>();
  readonly sent: Array<{ message: unknown; options: unknown }> = [];
  aborts = 0;
  throwOnSend = false;
  rejectNext: ((error: Error) => void) | undefined;

  on(name: string, handler: (event: any) => void): () => void {
    let handlers = this.handlers.get(name);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(name, handlers);
    }
    handlers.add(handler);
    return () => handlers?.delete(handler);
  }
  sendUserMessage(message: unknown, options: unknown): Promise<void> {
    if (this.throwOnSend) throw new Error("synchronous secret");
    this.sent.push({ message, options });
    if (this.rejectNext === null) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.rejectNext = reject;
      // Most tests model successful enqueue immediately.
      queueMicrotask(resolve);
    });
  }
  emit(name: string, event: any = { type: name }): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) handler(event);
  }
  api(): ExtensionAPI {
    return this as unknown as ExtensionAPI;
  }
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const userMessage = (text: string) => ({
  type: "message_end",
  message: { role: "user", content: [{ type: "text", text }] },
});
const assistantMessage = (text: string) => ({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

describe("current-session live bridge", () => {
  test("queues a follow-up but accepts only its exact transcript user message", async () => {
    const pi = new FakePi();
    const events: LiveBridgeEvent[] = [];
    const bridge = createCurrentSessionBridge(pi.api());
    let returned = false;
    const result = bridge.handoff({
      requestId: "voice-1",
      message: "do this",
      onEvent: (e) => {
        expect(returned).toBe(true);
        events.push(e);
      },
    });
    returned = true;
    expect(result).toEqual({ status: "queued", requestId: "voice-1" });
    expect(pi.sent).toEqual([{ message: "do this", options: { deliverAs: "followUp", expandPromptTemplates: false } }]);

    // input is preflight, and these lifecycle events belong to current work.
    pi.emit("input", { type: "input", source: "extension", text: "do this" });
    pi.emit("turn_start", { type: "turn_start", turnIndex: 7 });
    pi.emit("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "old",
      toolName: "execute",
      args: { secret: true },
    });
    pi.emit("message_end", userMessage("not do this"));
    await flush();
    expect(events).toEqual([]);

    pi.emit("message_end", userMessage("do this"));
    await flush();
    expect(events).toEqual([{ type: "accepted", requestId: "voice-1" }]);
  });

  test("associates tools across turns, switches only on accepted user text, and emits run_ended", async () => {
    const pi = new FakePi();
    const one: LiveBridgeEvent[] = [];
    const two: LiveBridgeEvent[] = [];
    const bridge = createCurrentSessionBridge(pi.api(), { maxReplyChars: 5 });
    bridge.handoff({ requestId: "one", message: "first", onEvent: (e) => one.push(e) });
    pi.emit("message_end", userMessage("first"));
    pi.emit("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "execute",
      args: { secret: "hidden" },
    });
    pi.emit("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "execute",
      result: { raw: "hidden" },
      isError: false,
    });
    pi.emit("turn_end", { type: "turn_end", outcome: "completed" });
    pi.emit("turn_start", { type: "turn_start", turnIndex: 2 });
    pi.emit("message_end", assistantMessage("abcdef"));

    bridge.handoff({ requestId: "two", message: "second", onEvent: (e) => two.push(e) });
    pi.emit("input", { type: "input", source: "extension", text: "second" });
    pi.emit("turn_start", { type: "turn_start", turnIndex: 3 });
    pi.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "still-one", toolName: "read" });
    pi.emit("message_end", userMessage("second"));
    pi.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "now-two", toolName: "write" });
    pi.emit("agent_end", { type: "agent_end", messages: [] });
    await flush();

    expect(one.map((e) => e.type)).toEqual([
      "accepted",
      "tool_started",
      "tool_finished",
      "turn_ended",
      "assistant_reply",
      "tool_started",
    ]);
    expect(one.find((e) => e.type === "assistant_reply")).toEqual({
      type: "assistant_reply",
      requestId: "one",
      text: "abcde",
      truncated: true,
    });
    expect(JSON.stringify(one)).not.toContain("secret");
    expect(two).toEqual([
      { type: "accepted", requestId: "two" },
      { type: "tool_started", requestId: "two", toolCallId: "now-two", toolName: "write" },
      { type: "run_ended", requestId: "two" },
    ]);
    expect(bridge.activeCount).toBe(0);
  });

  test("session callback honestly observes unassociated background resumptions", async () => {
    const pi = new FakePi();
    const session: CurrentSessionEvent[] = [];
    const bridge = createCurrentSessionBridge(pi.api(), { onSessionEvent: (e) => session.push(e), maxReplyChars: 3 });
    pi.emit("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "bg",
      toolName: "execute",
      args: { private: true },
    });
    pi.emit("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "bg",
      toolName: "execute",
      result: "raw",
      isError: true,
    });
    pi.emit("message_end", assistantMessage("resume"));
    pi.emit("turn_end", { type: "turn_end", outcome: "completed" });
    await flush();
    expect(session).toEqual([
      { type: "tool_started", scope: "current_session", toolCallId: "bg", toolName: "execute" },
      { type: "tool_finished", scope: "current_session", toolCallId: "bg", toolName: "execute", isError: true },
      { type: "assistant_reply", scope: "current_session", text: "res", truncated: true },
      { type: "turn_ended", scope: "current_session", outcome: "completed" },
    ]);
    expect(JSON.stringify(session)).not.toContain("private");
    bridge.stop();
  });

  test("consumes asynchronous delivery rejection and emits sanitized failure", async () => {
    const pi = new FakePi();
    const events: LiveBridgeEvent[] = [];
    const bridge = createCurrentSessionBridge(pi.api());
    bridge.handoff({ requestId: "fail", message: "message", onEvent: (e) => events.push(e) });
    pi.rejectNext?.(new Error("credential and prompt secret"));
    await flush();
    expect(events).toEqual([{ type: "delivery_failed", requestId: "fail", reason: "send_failed" }]);
    expect(JSON.stringify(events)).not.toContain("credential");
    expect(bridge.activeCount).toBe(0);
  });

  test("bounds state, handles synchronous throws, and stop never aborts", async () => {
    const pi = new FakePi();
    const bridge = createCurrentSessionBridge(pi.api(), { maxActive: 1, maxRecentIds: 1, maxMessageChars: 4 });
    const noop = () => {};
    expect(bridge.handoff({ requestId: "bad id", message: "ok", onEvent: noop }).status).toBe("invalid");
    pi.throwOnSend = true;
    expect(bridge.handoff({ requestId: "sync", message: "ok", onEvent: noop })).toEqual({
      status: "rejected",
      requestId: "sync",
      reason: "send_failed",
    });
    pi.throwOnSend = false;
    expect(bridge.handoff({ requestId: "a", message: "one", onEvent: noop }).status).toBe("queued");
    expect(bridge.handoff({ requestId: "b", message: "two", onEvent: noop }).status).toBe("full");
    bridge.stop();
    pi.emit("session_shutdown", { type: "session_shutdown" });
    await flush();
    expect(pi.aborts).toBe(0);
    expect(bridge.activeCount).toBe(0);
    expect(bridge.handoff({ requestId: "c", message: "two", onEvent: noop }).status).toBe("stopped");
  });
});
