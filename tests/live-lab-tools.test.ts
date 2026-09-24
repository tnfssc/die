import { describe, expect, test } from "bun:test";
import { VoiceSession } from "../src/live-lab/session.js";
import type { LiveAdapter, LiveConnection, LiveParams } from "../src/live-lab/types.js";

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(execute: (call: { id?: string; name?: string; args?: Record<string, unknown> }) => Promise<unknown>) {
  let params!: LiveParams;
  const audio: unknown[] = [];
  const responses: unknown[] = [];
  const contexts: unknown[] = [];
  const played: unknown[] = [];
  const connection = {
    sendRealtimeInput: (v: unknown) => audio.push(v),
    sendToolResponse: (v: unknown) => responses.push(v),
    sendClientContent: (v: unknown) => contexts.push(v),
    close: () => {},
  } as unknown as LiveConnection;
  const adapter: LiveAdapter = () => ({
    live: {
      connect: async (v) => {
        params = v;
        return connection;
      },
    },
  });
  const session = new VoiceSession({ onAudio: (data) => played.push(data) }, adapter, {
    tools: [{ name: "work", description: "do work" }],
    execute,
  });
  const send = (v: object) => params.callbacks.onmessage(v as Parameters<LiveParams["callbacks"]["onmessage"]>[0]);
  return {
    session,
    send,
    audio,
    played,
    responses,
    contexts,
    get params() {
      return params;
    },
  };
}

describe("SDK orchestration seam", () => {
  test("advertises NON_BLOCKING and processes audio while agent work is pending; duplicate and cancellation do not restart/stop work", async () => {
    let finish!: (v: unknown) => void;
    const calls: unknown[] = [];
    const h = fixture((call) => {
      calls.push(call);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await h.session.connect("key");
    expect(h.params.config?.tools).toMatchObject([
      { functionDeclarations: [{ name: "work", behavior: "NON_BLOCKING" }] },
    ]);
    h.send({ toolCall: { functionCalls: [{ id: "1", name: "work", args: { task: "a" } }] } });
    h.send({ toolCallCancellation: { ids: ["1"] }, serverContent: { interrupted: true } });
    h.send({ toolCall: { functionCalls: [{ id: "1", name: "work" }] } });
    h.session.sendAudio("AAAAAA==");
    h.send({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" } }] } },
    });
    expect(h.audio).toHaveLength(1);
    expect(h.played).toEqual(["AAAAAA=="]);
    await flush();
    expect(calls).toEqual([{ id: "1", name: "work", args: { task: "a" } }]);
    finish({ done: true });
    await flush();
    expect(h.responses).toEqual([
      { functionResponses: { id: "1", name: "work", response: { output: { done: true } } } },
    ]);
    h.session.sendContext("Job 1 completed");
    expect(h.contexts).toEqual([
      { turns: [{ role: "user", parts: [{ text: "Job 1 completed" }] }], turnComplete: false },
    ]);
  });
  test("failures sanitized, oversized args/results rejected, and disconnect never cancels agent execution", async () => {
    let finish!: (v: unknown) => void;
    let count = 0;
    const h = fixture(async (call) => {
      count++;
      if (call.id === "bad") throw Error("secret");
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await h.session.connect("key");
    h.send({
      toolCall: {
        functionCalls: [
          { id: "bad", name: "work" },
          { id: "large", name: "work", args: { data: "x".repeat(20000) } },
          { id: "unknown", name: "missing" },
          { id: "ok", name: "work" },
        ],
      },
    });
    await flush();
    expect(count).toBe(2);
    expect(h.responses).toContainEqual({
      functionResponses: { id: "bad", name: "work", response: { error: "Tool execution failed" } },
    });
    expect(h.responses).toContainEqual({
      functionResponses: { id: "large", name: "work", response: { error: "Tool request rejected" } },
    });
    finish("x".repeat(20000));
    await flush();
    expect(h.responses).toContainEqual({
      functionResponses: { id: "ok", name: "work", response: { error: "Tool result too large" } },
    });
    let resolve!: (v: unknown) => void;
    const later = fixture(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await later.session.connect("key");
    later.send({ toolCall: { functionCalls: [{ id: "disconnect", name: "work" }] } });
    await flush();
    later.session.close();
    resolve("done");
    await flush();
    expect(later.responses).toEqual([]);
  });
});
