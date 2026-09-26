import { describe, expect, test } from "bun:test";
import { VoiceSession } from "../src/live/session.js";
import liveSystemInstruction from "../src/prompts/live.md" with { type: "text" };
import type { LiveAdapter, LiveParams, LiveConnection } from "../src/live/types.js";

function harness() {
  let params!: LiveParams;
  let resolve!: (connection: LiveConnection) => void;
  let reject!: (error: Error) => void;
  const sends: unknown[] = [];
  let closes = 0;
  let onSend: (() => void) | undefined;
  const adapter: LiveAdapter = () =>
    ({
      live: {
        connect: (p: LiveParams) => {
          params = p;
          return new Promise<LiveConnection>((r, j) => {
            resolve = r;
            reject = j;
          });
        },
      },
    }) as ReturnType<LiveAdapter>;
  const connection = {
    sendClientContent: (data: unknown) => {
      sends.push(data);
    },
    sendToolResponse: (data: unknown) => {
      sends.push(data);
    },
    sendRealtimeInput: (data: unknown) => {
      sends.push(data);
      onSend?.();
    },
    close: () => {
      closes++;
    },
  } as unknown as LiveConnection;
  return {
    adapter,
    sends,
    get params() {
      return params;
    },
    get closes() {
      return closes;
    },
    ready: () => resolve(connection),
    reject: () => reject(new Error("secret")),
    setOnSend: (f: () => void) => {
      onSend = f;
    },
  };
}
const msg = (content: object) => content as Parameters<LiveParams["callbacks"]["onmessage"]>[0];
const audio = (data = "AAAAAA==", mimeType = "audio/pcm;rate=24000") => ({
  modelTurn: { parts: [{ inlineData: { mimeType, data } }] },
});

describe("voice-only SDK session", () => {
  test("direct main agent uses external instructions and dispatches execute once", async () => {
    const h = harness();
    const calls: unknown[] = [];
    const s = new VoiceSession({}, h.adapter, {
      instructions: "ordinary root prompt",
      directMainAgent: true,
      tools: [{ name: "execute", parametersJsonSchema: { type: "object", properties: { code: { type: "string" } } } }],
      userTranscript: () => {},
      execute: async (call) => {
        calls.push(call);
        return { content: [{ type: "text", text: "done" }] };
      },
    });
    const connecting = s.connect("fake");
    expect(h.params.config?.systemInstruction).toBe("ordinary root prompt");
    expect(h.params.config?.tools).toMatchObject([{ functionDeclarations: [{ name: "execute" }] }]);
    h.ready();
    await connecting;
    const call = msg({ toolCall: { functionCalls: [{ id: "c1", name: "execute", args: { code: "1+1" } }] } });
    h.params.callbacks.onmessage(call);
    h.params.callbacks.onmessage(call);
    await Bun.sleep(0);
    expect(calls).toEqual([{ id: "c1", name: "execute", args: { code: "1+1" } }]);
    expect(h.sends).toEqual([
      expect.objectContaining({
        functionResponses: expect.objectContaining({
          id: "c1",
          response: { output: { content: [{ type: "text", text: "done" }] } },
        }),
      }),
    ]);
    s.close();
  });
  test("Gemini SDK usageMetadata reaches billing without audio render", async () => {
    const h = harness();
    const usage: unknown[] = [];
    const s = new VoiceSession({ onUsage: (u) => usage.push(u) }, h.adapter);
    const pending = s.connect("fake");
    h.ready();
    await pending;
    h.params.callbacks.onmessage(
      msg({ usageMetadata: { promptTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }] } }),
    );
    expect(usage).toEqual([{ promptTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }] }]);
    s.close();
  });
  test("extended-thinking selected endpoint retains direct owner setup and transcription finality", async () => {
    const h = harness();
    const heard: unknown[] = [];
    const s = new VoiceSession({ onInputTranscript: (t) => heard.push(t) }, h.adapter, {
      instructions: "root", directMainAgent: true, tools: [{ name: "execute", parametersJsonSchema: { type: "object" } }],
      userTranscript: () => {}, execute: async () => ({ content: [] }),
    }, "gemini-3.8-live-extended-thinking");
    const pending = s.connect("fake");
    expect(h.params.model).toBe("gemini-3.8-live-extended-thinking");
    expect(h.params.config).toMatchObject({ systemInstruction: "root", responseModalities: ["AUDIO"], tools: [{ functionDeclarations: [{ name: "execute" }] }] });
    h.ready();
    await pending;
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: "hello" } } }));
    expect(heard).toEqual([expect.objectContaining({ text: "hello", finished: true, finalitySource: "model_contract" })]);
    s.close();
  });
  test("ready only after SDK setup-accepted promise, VAD, mic and end idempotence", async () => {
    const h = harness();
    const events: string[] = [];
    const s = new VoiceSession({ onReady: () => events.push("ready"), onState: (v) => events.push(v) }, h.adapter);
    s.sendAudio("AAAAAA==");
    const pending = s.connect("key");
    expect(h.params.model).toBe("gemini-3.8-live");
    expect(h.params.config).toMatchObject({
      responseModalities: ["AUDIO"],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: { automaticActivityDetection: { disabled: false } },
    });
    expect(h.params.config?.tools).toBeUndefined();
    expect(h.params.config?.systemInstruction).toBe(liveSystemInstruction);
    h.params.callbacks.onmessage(msg({ setupComplete: {} }));
    expect(s.state).toBe("connecting");
    expect(h.sends).toHaveLength(0);
    h.ready();
    await pending;
    s.sendAudio("AAAAAA==");
    s.sendAudio("not base64");
    s.endAudio();
    s.endAudio();
    expect(h.sends).toEqual([
      { audio: { data: "AAAAAA==", mimeType: "audio/pcm;rate=16000" } },
      { audioStreamEnd: true },
    ]);
    expect(events).toEqual(["connecting", "ready", "ready"]);
    s.close();
    s.close();
    expect(h.closes).toBe(1);
    expect(() => s.connect("again")).toThrow();
  });
  test("interrupted packet audio discarded; only interruption flushes, transcript metadata retained", async () => {
    const h = harness();
    const out: unknown[] = [];
    const s = new VoiceSession(
      {
        onAudio: (a, g) => out.push(["audio", a, g]),
        onInputTranscript: (t) => out.push(["input", t]),
        onOutputTranscript: (t, g) => out.push(["output", t, g]),
        onInterrupted: (g) => out.push(["flush", g]),
        onTurnComplete: (t) => out.push(["done", t]),
      },
      h.adapter,
    );
    const pending = s.connect("key");
    h.ready();
    await pending;
    h.params.callbacks.onmessage(
      msg({
        serverContent: {
          ...audio(),
          inputTranscription: { text: "heard", finished: true, languageCode: "en" },
          outputTranscription: { text: "said", finished: false },
          turnComplete: true,
        },
      }),
    );
    h.params.callbacks.onmessage(
      msg({
        serverContent: {
          interrupted: true,
          ...audio(),
          outputTranscription: { text: "", finished: true },
          turnComplete: true,
        },
      }),
    );
    h.params.callbacks.onmessage(msg({ serverContent: { ...audio(), turnComplete: true } }));
    expect(out).toEqual([
      ["audio", "AAAAAA==", 0],
      ["input", { text: "heard", finished: true, rawFinished: true, finalitySource: "provider", languageCode: "en" }],
      ["output", { text: "said", finished: false }, 0],
      ["done", 0],
      ["flush", 1],
      ["output", { text: "", finished: true, interrupted: true }, 1],
      ["done", 1],
      ["audio", "AAAAAA==", 1],
      ["done", 2],
    ]);
    expect(s.generation).toBe(1);
    expect(s.turn).toBe(3);
    expect(s.diagnostics).toMatchObject({ serverInterruptions: 1, turnCompletions: 3 });
    expect(s.diagnostics.lastInterruptedAtMs).toBeGreaterThan(0);
  });
  test("normal completion and local transport failure never count as provider interruption", async () => {
    const h = harness();
    const s = new VoiceSession({}, h.adapter);
    const connecting = s.connect("key");
    h.ready();
    await connecting;
    h.params.callbacks.onmessage(msg({ serverContent: { turnComplete: true } }));
    expect(s.diagnostics).toEqual({ serverInterruptions: 0, turnCompletions: 1, lastInterruptedAtMs: undefined });
    h.params.callbacks.onerror?.({} as ErrorEvent);
    expect(s.state).toBe("closed");
    expect(s.diagnostics.serverInterruptions).toBe(0);
  });
  test("invalid output mime/rate and aggregate audio limit fail safely once", async () => {
    for (const [content, expected] of [
      [audio("AAAAAA==", "audio/pcm;rate=240000"), "Invalid output audio chunk"],
      [audio("AAAAAA==".repeat(32001)), "Invalid output audio chunk"],
    ] as const) {
      const h = harness();
      const errors: unknown[] = [];
      const s = new VoiceSession({ onError: (e) => errors.push(e) }, h.adapter);
      const pending = s.connect("key");
      h.ready();
      await pending;
      h.params.callbacks.onmessage(msg({ serverContent: content }));
      expect(errors).toEqual([{ code: "invalid_audio", message: expected }]);
      expect(s.state).toBe("closed");
      h.params.callbacks.onerror?.({} as ErrorEvent);
      expect(h.closes).toBe(1);
    }
    const h = harness();
    const errors: unknown[] = [];
    const s = new VoiceSession({ onError: (e) => errors.push(e) }, h.adapter);
    const p = s.connect("key");
    h.ready();
    await p;
    const chunk = Buffer.alloc(96000).toString("base64");
    for (let i = 0; i < 25; i++) h.params.callbacks.onmessage(msg({ serverContent: audio(chunk) }));
    expect(errors).toEqual([{ code: "invalid_audio", message: "Voice turn audio limit exceeded" }]);
  });
  test("aggregate transcript limit gives explicit terminal error", async () => {
    const h = harness();
    const out: unknown[] = [];
    const s = new VoiceSession({ onError: (e) => out.push(e) }, h.adapter);
    const p = s.connect("key");
    h.ready();
    await p;
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: "x".repeat(4096) } } }));
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: "x" } } }));
    expect(out).toEqual([{ code: "transcript_limit", message: "Voice transcription limit exceeded" }]);
    expect(s.state).toBe("closed");
  });
  test("close during pending connect cancels immediately, late result closed, no callbacks", async () => {
    const h = harness();
    const out: unknown[] = [];
    const s = new VoiceSession({ onReady: () => out.push("ready"), onError: (e) => out.push(e) }, h.adapter);
    const pending = s.connect("private");
    s.close();
    await pending;
    h.ready();
    await Promise.resolve();
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: "secret" } } }));
    expect(out).toEqual([]);
    expect(h.closes).toBe(1);
    const k = harness();
    const next = new VoiceSession({}, k.adapter);
    const p = next.connect("key");
    next.close();
    await p;
    k.reject();
    await Promise.resolve();
  });
  test("SDK close/error, goAway and reentrant callbacks cannot revive session or escape", async () => {
    const h = harness();
    const out: unknown[] = [];
    const s = new VoiceSession(
      {
        onError: (e) => {
          out.push(e);
          throw Error("user");
        },
        onState: (v) => {
          out.push(v);
          if (v === "closed") throw Error("user");
        },
      },
      h.adapter,
    );
    const p = s.connect("key");
    h.ready();
    await p;
    h.params.callbacks.onclose?.({} as CloseEvent);
    h.params.callbacks.onerror?.({} as ErrorEvent);
    expect(out).toEqual([
      "connecting",
      "ready",
      "closed",
      { code: "disconnected", message: "Voice connection closed" },
    ]);
    expect(h.closes).toBe(1);
    const k = harness();
    const errors: unknown[] = [];
    const second = new VoiceSession(
      {
        onAudio: () => {
          throw Error("secret");
        },
        onError: (e) => errors.push(e),
      },
      k.adapter,
    );
    const q = second.connect("key");
    k.ready();
    await q;
    expect(() => k.params.callbacks.onmessage(msg({ serverContent: audio() }))).not.toThrow();
    expect(errors).toEqual([{ code: "transport_error", message: "Voice callback failed" }]);
    const x = harness();
    const third = new VoiceSession({ onReady: () => third.close() }, x.adapter);
    const r = third.connect("key");
    x.ready();
    await r;
    expect(third.state).toBe("closed");
    expect(x.closes).toBe(1);
    const y = harness();
    const expiry: unknown[] = [];
    const fourth = new VoiceSession({ onError: (e) => expiry.push(e) }, y.adapter);
    const z = fourth.connect("key");
    y.ready();
    await z;
    y.params.callbacks.onmessage(msg({ goAway: { timeLeft: "3s" } }));
    expect(expiry).toEqual([{ code: "expiring", message: "Voice session expiring; start a new session" }]);
  });
  test("setup never completes: bounded timeout, no late mic or duplicate failure", async () => {
    const h = harness();
    const out: unknown[] = [];
    const original = globalThis.setTimeout;
    let trigger: (() => void) | undefined;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      expect(ms).toBe(15000);
      trigger = fn;
      return original(() => {}, 60000);
    }) as typeof setTimeout;
    try {
      const s = new VoiceSession({ onReady: () => out.push("ready"), onError: (e) => out.push(e) }, h.adapter);
      const p = s.connect("key");
      trigger?.();
      await p;
      h.ready();
      await Promise.resolve();
      s.sendAudio("AAAAAA==");
      h.params.callbacks.onclose?.({} as CloseEvent);
      expect(h.closes).toBe(1);
      expect(h.sends).toHaveLength(0);
      expect(out).toEqual([{ code: "connect_failed", message: "Voice connection timed out" }]);
    } finally {
      globalThis.setTimeout = original;
    }
  });
  test("send reentrant close and onState connecting close prevent late mic", async () => {
    const h = harness();
    const s = new VoiceSession(
      {
        onState: (v) => {
          if (v === "connecting") s.close();
        },
      },
      h.adapter,
    );
    await s.connect("key");
    expect(s.state).toBe("closed");
    expect(h.sends).toEqual([]);
    const k = harness();
    const second = new VoiceSession({}, k.adapter);
    const p = second.connect("key");
    k.ready();
    await p;
    k.setOnSend(() => second.close());
    second.sendAudio("AAAAAA==");
    expect(second.state).toBe("closed");
    expect(k.closes).toBe(1);
  });
});

test("main Gemini context retains large history and completion explicitly triggers voice", async () => {
  const h = harness();
  const s = new VoiceSession({}, h.adapter, {
    instructions: "root",
    directMainAgent: true,
    tools: [],
    userTranscript() {},
    async execute() {},
  });
  const pending = s.connect("fake");
  h.ready();
  await pending;
  const history = "history:" + "x".repeat(12000);
  s.sendContext(history, { triggerResponse: false });
  s.sendContext("job completed");
  expect(h.sends).toEqual([
    { turns: [{ role: "user", parts: [{ text: history }] }], turnComplete: false },
    { turns: [{ role: "user", parts: [{ text: "job completed" }] }], turnComplete: true },
  ]);
  s.close();
});
