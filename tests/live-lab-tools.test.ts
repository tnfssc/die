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
    userTranscript: () => {},
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
      { functionResponses: { scheduling: "WHEN_IDLE", id: "1", name: "work", response: { output: { done: true } } } },
    ]);
    h.session.sendContext("Job 1 completed");
    await Bun.sleep(130);
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
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "bad",
        name: "work",
        response: { error: "Tool execution failed" },
      },
    });
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "large",
        name: "work",
        response: { error: "Tool request rejected" },
      },
    });
    finish("x".repeat(20000));
    await flush();
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "ok",
        name: "work",
        response: { error: "Tool result too large" },
      },
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

test("host context coalesces bounded updates, reports gaps, and keeps audio live after 65k cumulative", async () => {
  let calls = 0;
  const h = fixture(async () => {
    calls++;
  });
  await h.session.connect("fake");
  for (let i = 0; i < 18; i++) {
    h.session.sendContext(`update ${i} ` + "x".repeat(4000));
    h.session.sendAudio("AAAAAA==");
    await Bun.sleep(120);
  }
  h.session.sendContext("dropped " + "x".repeat(4096));
  h.session.sendContext("latest verified status");
  await Bun.sleep(130);
  expect(h.contexts).toHaveLength(19);
  expect(h.audio).toHaveLength(18);
  const lastText = (h.contexts.at(-1) as { turns: { parts: { text: string }[] }[] }).turns[0]!.parts[0]!.text;
  expect(lastText).toContain("[Some earlier host updates omitted;");
  expect(lastText).toContain("latest verified status");
  expect(lastText).not.toContain("dropped ");
  h.session.sendAudio("AAAAAA==");
  expect(h.audio).toHaveLength(19);
  expect(h.session.state).toBe("ready");
  expect(calls).toBe(0);
});

test("tool concurrency is bounded without blocking microphone and cancellation does not call host stop", async () => {
  let calls = 0;
  const h = fixture(async () => {
    calls++;
    return new Promise(() => {});
  });
  await h.session.connect("fake");
  h.send({ toolCall: { functionCalls: Array.from({ length: 17 }, (_, i) => ({ id: String(i), name: "work" })) } });
  await flush();
  h.session.sendAudio("AAAAAA==");
  expect(calls).toBe(16);
  expect(h.audio).toHaveLength(1);
  expect(h.responses).toContainEqual({
    functionResponses: {
      id: "16",
      name: "work",
      response: { error: "Tool request rejected" },
      scheduling: "WHEN_IDLE",
    },
  });
  h.session.close();
});

test("an admitted tool request survives voice disconnect, but new messages after close cannot dispatch", async () => {
  let calls = 0;
  const h = fixture(async () => {
    calls++;
    return { queued: true };
  });
  await h.session.connect("fake");
  h.send({ toolCall: { functionCalls: [{ id: "admitted", name: "work" }] } });
  h.session.close();
  h.send({ toolCall: { functionCalls: [{ id: "too-late", name: "work" }] } });
  await flush();
  expect(calls).toBe(1);
  expect(h.responses).toHaveLength(0);
});

test("duplicate SDK IDs replay completed bounded response without re-execution", async () => {
  let calls = 0;
  let finish!: (v: unknown) => void;
  const h = fixture(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await h.session.connect("fake");
  h.send({
    toolCall: {
      functionCalls: [
        { id: "same", name: "work" },
        { id: "same", name: "work" },
      ],
    },
  });
  await flush();
  expect(calls).toBe(1);
  finish("ok");
  await flush();
  h.send({ toolCall: { functionCalls: [{ id: "same", name: "work", args: { different: true } }] } });
  expect(calls).toBe(1);
  expect(h.responses).toEqual(
    Array(2).fill({
      functionResponses: {
        id: "same",
        name: "work",
        response: { output: "ok" },
        scheduling: "WHEN_IDLE",
      },
    }),
  );
});

test("context bursts share one bounded packet and a pending close sends nothing", async () => {
  const h = fixture(async () => null);
  await h.session.connect("fake");
  h.session.sendContext("first update");
  h.session.sendContext("second update");
  await Bun.sleep(130);
  expect(h.contexts).toEqual([
    { turns: [{ role: "user", parts: [{ text: "first update\nsecond update" }] }], turnComplete: false },
  ]);
  h.session.sendContext("not sent after close");
  h.session.close();
  await Bun.sleep(130);
  expect(h.contexts).toHaveLength(1);
});

test("update flood drops old observations honestly while audio continues", async () => {
  const h = fixture(async () => null);
  await h.session.connect("fake");
  for (let i = 0; i < 1000; i++) {
    h.session.sendContext(`verified-${i} ` + "x".repeat(100));
    h.session.sendAudio("AAAAAA==");
  }
  await Bun.sleep(130);
  const packet = (h.contexts[0] as any).turns[0].parts[0].text;
  expect(h.contexts).toHaveLength(1);
  expect(packet.length).toBeLessThanOrEqual(4096);
  expect(packet).toContain("Some earlier host updates omitted");
  expect(packet).toContain("verified-999");
  expect(h.audio).toHaveLength(1000);
  expect(h.session.state).toBe("ready");
  h.session.close();
});
