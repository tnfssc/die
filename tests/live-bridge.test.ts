import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCurrentSessionBridge, type LiveBridgeEvent } from "../src/live/bridge";

class FakePi {
  readonly handlers = new Map<string, Set<(event: any) => void>>();
  readonly sent: Array<{ message: unknown; options: unknown }> = [];
  aborts = 0;
  emitInputOnSend = false;
  throwOnSend = false;

  on(name: string, handler: (event: any) => void): () => void {
    let handlers = this.handlers.get(name);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(name, handlers);
    }
    handlers.add(handler);
    return () => handlers?.delete(handler);
  }

  sendUserMessage(message: unknown, options: unknown): void {
    if (this.throwOnSend) throw new Error("offline fake rejection");
    this.sent.push({ message, options });
    if (this.emitInputOnSend) this.emit("input", { type: "input", source: "extension", text: message });
  }

  emit(name: string, event: any = { type: name }): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) handler(event);
  }

  api(): ExtensionAPI {
    return this as unknown as ExtensionAPI;
  }
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("current-session live bridge", () => {
  test("returns queued synchronously, uses follow-up delivery, and confirms acceptance later", async () => {
    const pi = new FakePi();
    pi.emitInputOnSend = true;
    const events: LiveBridgeEvent[] = [];
    const bridge = createCurrentSessionBridge(pi.api());

    let returned = false;
    const result = bridge.handoff({
      requestId: "voice-1",
      message: "Use the current session",
      onEvent: (event) => {
        expect(returned).toBe(true);
        events.push(event);
      },
    });
    returned = true;

    expect(result).toEqual({ status: "queued", requestId: "voice-1" });
    expect(pi.sent).toEqual([
      {
        message: "Use the current session",
        options: { deliverAs: "followUp", expandPromptTemplates: false },
      },
    ]);
    expect(events).toEqual([]);
    await flush();
    expect(events).toEqual([{ type: "accepted", requestId: "voice-1" }]);
  });

  test("reports only bounded assistant text and tool metadata for the associated turn", async () => {
    const pi = new FakePi();
    const first: LiveBridgeEvent[] = [];
    const second: LiveBridgeEvent[] = [];
    const bridge = createCurrentSessionBridge(pi.api(), { maxReplyChars: 5 });

    bridge.handoff({ requestId: "one", message: "first", onEvent: (event) => first.push(event) });
    pi.emit("input", { type: "input", source: "extension", text: "first" });
    pi.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });

    bridge.handoff({ requestId: "two", message: "second", onEvent: (event) => second.push(event) });
    pi.emit("input", { type: "input", source: "extension", text: "second" });
    pi.emit("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "execute",
      args: { secret: "not forwarded" },
    });
    pi.emit("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "execute",
      result: { secret: "not forwarded" },
      isError: false,
    });
    pi.emit("message_end", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: "abcdef" },
          { type: "toolCall", id: "raw", name: "execute", arguments: {} },
        ],
      },
    });
    pi.emit("turn_end", { type: "turn_end", outcome: "completed" });
    pi.emit("agent_end", { type: "agent_end", messages: [] });
    await flush();

    expect(first).toEqual([
      { type: "accepted", requestId: "one" },
      { type: "tool_started", requestId: "one", toolCallId: "tool-1", toolName: "execute" },
      {
        type: "tool_finished",
        requestId: "one",
        toolCallId: "tool-1",
        toolName: "execute",
        isError: false,
      },
      { type: "assistant_reply", requestId: "one", text: "abcde", truncated: true },
      { type: "turn_ended", requestId: "one", outcome: "completed" },
    ]);
    expect(JSON.stringify(first)).not.toContain("secret");
    // Acceptance does not associate a queued follow-up with the current turn.
    expect(second).toEqual([{ type: "accepted", requestId: "two" }]);

    pi.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 2 });
    pi.emit("message_end", {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    });
    await flush();
    expect(second.at(-1)).toEqual({ type: "assistant_reply", requestId: "two", text: "ok", truncated: false });
  });

  test("does not infer acceptance or completion from generic lifecycle events", async () => {
    const pi = new FakePi();
    const events: LiveBridgeEvent[] = [];
    const bridge = createCurrentSessionBridge(pi.api());
    bridge.handoff({ requestId: "background", message: "start a job", onEvent: (event) => events.push(event) });

    pi.emit("input", { type: "input", source: "interactive", text: "start a job" });
    pi.emit("agent_end", { type: "agent_end", messages: [] });
    await flush();
    expect(events).toEqual([]);
    expect(bridge.activeCount).toBe(1);

    pi.emit("input", { type: "input", source: "extension", text: "start a job" });
    pi.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
    pi.emit("agent_end", { type: "agent_end", messages: [] });
    await flush();
    expect(events).toEqual([{ type: "accepted", requestId: "background" }]);
    expect(bridge.activeCount).toBe(0);
    expect(bridge.handoff({ requestId: "background", message: "again", onEvent: () => {} }).status).toBe("duplicate");
    expect(pi.sent).toHaveLength(1);
  });

  test("bounds active requests and handles active duplicates without a second send", () => {
    const pi = new FakePi();
    const bridge = createCurrentSessionBridge(pi.api(), { maxActive: 2, maxRecentIds: 1 });
    const noop = () => {};

    expect(bridge.handoff({ requestId: "a", message: "a", onEvent: noop }).status).toBe("queued");
    expect(bridge.handoff({ requestId: "a", message: "changed", onEvent: noop }).status).toBe("duplicate");
    expect(bridge.handoff({ requestId: "b", message: "b", onEvent: noop }).status).toBe("queued");
    expect(bridge.handoff({ requestId: "c", message: "c", onEvent: noop }).status).toBe("full");
    expect(pi.sent.map(({ message }) => message)).toEqual(["a", "b"]);
  });

  test("cancel, stop, and session shutdown detach only; they never abort the agent", async () => {
    const pi = new FakePi();
    const events: LiveBridgeEvent[] = [];
    const bridge = createCurrentSessionBridge(pi.api());
    bridge.handoff({ requestId: "cancel-me", message: "continue", onEvent: (event) => events.push(event) });
    pi.emit("input", { type: "input", source: "extension", text: "continue" });
    expect(bridge.cancel("cancel-me")).toBe(true);
    await flush();
    expect(events).toEqual([]);
    expect(pi.aborts).toBe(0);

    bridge.handoff({ requestId: "shutdown", message: "keep agent alive", onEvent: (event) => events.push(event) });
    pi.emit("session_shutdown", { type: "session_shutdown" });
    expect(bridge.activeCount).toBe(0);
    expect(bridge.handoff({ requestId: "later", message: "later", onEvent: () => {} }).status).toBe("stopped");
    expect(pi.aborts).toBe(0);
    bridge.stop();
  });

  test("rejects invalid/full messages and recovers from synchronous send failures", () => {
    const pi = new FakePi();
    const bridge = createCurrentSessionBridge(pi.api(), { maxMessageChars: 4 });
    const noop = () => {};
    expect(bridge.handoff({ requestId: "bad id", message: "ok", onEvent: noop })).toMatchObject({
      status: "invalid",
      reason: "request_id",
    });
    expect(bridge.handoff({ requestId: "long", message: "12345", onEvent: noop })).toMatchObject({
      status: "invalid",
      reason: "message",
    });
    pi.throwOnSend = true;
    expect(bridge.handoff({ requestId: "send", message: "ok", onEvent: noop })).toEqual({
      status: "rejected",
      requestId: "send",
      reason: "send_failed",
    });
    expect(bridge.activeCount).toBe(0);
    pi.throwOnSend = false;
    expect(bridge.handoff({ requestId: "send", message: "ok", onEvent: noop }).status).toBe("queued");
  });
});
