import { test, expect } from "bun:test";
import { GPTLiveSession, type LiveSocket, type GPTLiveCallbacks } from "../src/live/gpt-live-session";
import gptLiveInstruction from "../src/prompts/gpt-live.md" with { type: "text" };

class Socket implements LiveSocket {
  bufferedAmount = 0;
  sent: any[] = [];
  closed = false;
  handlers = new Map<string, ((event: any) => void)[]>();
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.fire("close");
  }
  addEventListener(type: "open" | "message" | "error" | "close", handler: (event: any) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  fire(type: string, event: any = {}) {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
  event(body: object) {
    this.fire("message", { data: JSON.stringify(body) });
  }
  ready() {
    this.fire("open");
    this.event({
      type: "session.started",
      session: { id: "live_1", model: "gpt-live-1", delegation: { type: "client" } },
    });
  }
}
function fixture(callbacks: GPTLiveCallbacks = {}) {
  const socket = new Socket();
  const endpoints: any[] = [];
  const session = new GPTLiveSession(callbacks, (url, headers) => {
    endpoints.push({ url, headers });
    return socket;
  });
  return { socket, session, endpoints };
}

test("official primary Live handshake and continuous microphone resampling; no Realtime commands", async () => {
  const ready: string[] = [];
  const { socket, session, endpoints } = fixture({ onReady: (id) => ready.push(id) });
  const pending = session.connect("test-key-not-real");
  expect(endpoints).toEqual([
    { url: "wss://api.openai.com/v1/live/sessions", headers: { Authorization: "Bearer test-key-not-real" } },
  ]);
  expect(session.appendMicrophone(new Uint8Array(640))).toBe(false);
  socket.fire("open");
  expect(socket.sent).toEqual([
    {
      type: "session.start",
      event_id: "live_start",
      session: {
        model: "gpt-live-1",
        instructions: gptLiveInstruction.trimEnd(),
        audio: { format: { type: "audio/pcm", rate: 24000 }, output: { voice: "marin" } },
        delegation: { type: "client" },
      },
    },
  ]);
  socket.event({
    type: "session.started",
    session: { id: "live_1", model: "gpt-live-1", delegation: { type: "client" } },
  });
  await pending;
  expect(ready).toEqual(["live_1"]);
  for (let i = 0; i < 50; i++) expect(session.appendMicrophone(new Uint8Array(640))).toBe(true);
  expect(socket.sent.slice(1).every((event) => event.type === "session.input_audio.append")).toBe(true);
  expect(socket.sent.slice(1).reduce((n, event) => n + Buffer.from(event.audio, "base64").length, 0)).toBe(47_998);
  expect(() => session.appendMicrophone(new Uint8Array(3))).toThrow();
  const done = session.close();
  expect(socket.sent.at(-1)).toEqual({ type: "session.close" });
  socket.event({ type: "session.closed", usage: { seconds: 2 } });
  await done;
  expect(session.state).toBe("closed");
});

test("interleaved provisional transcripts and offset-only client delegation, dedupe, scoped updates", async () => {
  const input: any[] = [],
    output: any[] = [],
    delegates: any[] = [],
    pcm: Uint8Array[] = [];
  const { socket, session } = fixture({
    onInputTranscript: (x) => input.push(x),
    onOutputTranscript: (x) => output.push(x),
    onDelegation: (x) => delegates.push(x),
    onAudio: (x) => pcm.push(x),
  });
  const start = session.connect("fake");
  socket.ready();
  await start;
  const fragment = (delta: string, start_ms: number, end_ms: number) =>
    socket.event({ type: "session.input_transcript.delta", delta, start_ms, end_ms });
  fragment("Thursday", 100, 400);
  socket.event({ type: "session.output_transcript.delta", delta: "Checking", start_ms: 410, end_ms: 700 });
  const delegate = {
    type: "session.delegation.created",
    offset_ms: 400,
    delegation: { id: "item_1", type: "delegation", target: "client" },
  };
  socket.event(delegate);
  socket.event(delegate);
  fragment(", not Friday", 250, 500); // late correction: offset does not confer transcript finality
  expect(input).toEqual([
    { delta: "Thursday", startMs: 100, endMs: 400 },
    { delta: ", not Friday", startMs: 250, endMs: 500 },
  ]);
  expect(output).toEqual([{ delta: "Checking", startMs: 410, endMs: 700 }]);
  expect(delegates).toEqual([{ id: "item_1", target: "client", offsetMs: 400 }]);
  expect(session.commentary("unknown", "done")).toBe(false);
  expect(session.thinking("item_1", "Checking, nothing changed yet")).toBe(true);
  expect(session.commentary("item_1", "Confirmed for Thursday")).toBe(true);
  expect(socket.sent.slice(-2)).toEqual([
    { type: "session.thinking.append", event_id: "live_context_1", delegation_id: "item_1", content: "Checking, nothing changed yet" },
    { type: "session.commentary.append", event_id: "live_context_2", delegation_id: "item_1", content: "Confirmed for Thursday" },
  ]);
  socket.event({ type: "session.output_audio.delta", delta: Buffer.alloc(19_200).toString("base64") });
  expect(pcm.map((x) => x.length)).toEqual([9_600, 9_600]);
  socket.event({
    type: "session.delegation.created",
    offset_ms: 800,
    delegation: { id: "responses_1", target: "responses" },
  });
  expect(delegates).toHaveLength(1);
  const closing = session.close();
  socket.event({ type: "session.closed" });
  await closing;
});

test("bounded queue, malformed PCM and abrupt disconnect fail without inventing final usage", async () => {
  const errors: string[] = [],
    closed: boolean[] = [];
  const { socket, session } = fixture({ onError: (e) => errors.push(e), onClosed: (final) => closed.push(final) });
  const start = session.connect("fake");
  socket.ready();
  await start;
  socket.bufferedAmount = 192_000;
  expect(session.appendMicrophone(new Uint8Array(640))).toBe(false);
  expect(errors).toEqual(["Live send queue exceeded limit"]);
  expect(closed).toEqual([false]);
  expect(session.state).toBe("closed");
  socket.event({ type: "session.closed" });
  expect(closed).toEqual([false]);
  const other = fixture({ onError: (e) => errors.push(e) });
  const p = other.session.connect("fake");
  other.socket.ready();
  await p;
  other.socket.event({ type: "session.output_audio.delta", delta: Buffer.alloc(3).toString("base64") });
  expect(errors.at(-1)).toBe("Invalid Live audio");
  const abrupt = fixture({ onClosed: (x) => closed.push(x) });
  const p2 = abrupt.session.connect("fake");
  abrupt.socket.ready();
  await p2;
  abrupt.socket.fire("close");
  expect(closed).toEqual([false, false]);
});

test("final usage is only known on session.closed, early provider errors are sanitized", async () => {
  const errors: string[] = [],
    closed: any[] = [];
  const { session, socket } = fixture({
    onError: (e) => errors.push(e),
    onClosed: (finalized, usage) => closed.push({ finalized, usage }),
  });
  const start = session.connect("fake");
  socket.fire("open");
  socket.event({ type: "error", error: { message: "SECRET key", code: "invalid_api_key" } });
  await start;
  expect(errors).toEqual(["OpenAI rejected the API key for gpt-live-1. Use /login to configure an OpenAI API key."]);
  expect(closed).toEqual([{ finalized: false, usage: undefined }]);
  const f = fixture({ onClosed: (finalized, usage) => closed.push({ finalized, usage }) });
  const p = f.session.connect("fake");
  f.socket.ready();
  await p;
  const ending = f.session.close();
  f.socket.event({ type: "session.closed", reason: "close_requested", usage: { total_audio_seconds: 4 } });
  await ending;
  expect(closed.at(-1)).toEqual({ finalized: true, usage: { total_audio_seconds: 4 } });
  expect(f.session.commentary("anything", "late")).toBe(false);
});

test("rejects different resolved model or delegation before audio can flow", async () => {
  const errors: string[] = [];
  const { socket, session } = fixture({ onError: (e) => errors.push(e) });
  const start = session.connect("fake");
  socket.fire("open");
  socket.event({
    type: "session.started",
    session: { id: "live_1", model: "gpt-realtime-2.1", delegation: { type: "client" } },
  });
  await start;
  expect(errors).toEqual(["Invalid Live session.started"]);
  expect(session.appendMicrophone(new Uint8Array(640))).toBe(false);
});

test("timeout and explicit close invalidate pending handshake and stale callbacks", async () => {
  const errors: string[] = [];
  const socket = new Socket();
  let audio = 0;
  const session = new GPTLiveSession(
    {
      onError: (e) => errors.push(e),
      onAudio: () => {
        audio++;
      },
    },
    () => socket,
    { connectMs: 5, closeMs: 5 },
  );
  const pending = session.connect("fake");
  await Bun.sleep(10);
  await pending;
  expect(session.state).toBe("closed");
  expect(errors).toEqual(["Live session start timed out"]);
  socket.ready();
  socket.event({ type: "session.output_audio.delta", delta: Buffer.alloc(960).toString("base64") });
  expect(audio).toBe(0);
  expect(socket.sent).toEqual([]);
  const f = fixture();
  const connect = f.session.connect("fake");
  await f.session.close();
  await connect;
  f.socket.ready();
  expect(f.session.state).toBe("closed");
  expect(f.socket.sent).toEqual([]);
});

test("close deadline reports unknown final usage and no queued PCM survives closure", async () => {
  const socket = new Socket();
  const finalized: boolean[] = [];
  const errors: string[] = [];
  const session = new GPTLiveSession(
    { onClosed: (f) => finalized.push(f), onError: (e) => errors.push(e) },
    () => socket,
    { connectMs: 50, closeMs: 5 },
  );
  const pending = session.connect("fake");
  socket.ready();
  await pending;
  const closing = session.close();
  expect(session.appendMicrophone(Buffer.alloc(640))).toBe(false);
  await Bun.sleep(10);
  await closing;
  expect(finalized).toEqual([false]);
  expect(errors).toEqual(["Live session.close timed out; final usage unknown"]);
  expect(session.closeError).toBe("Live session.close timed out; final usage unknown");
});

test("general host observations use nullable delegation and enforce conservative text token budget", async () => {
  const f = fixture();
  const connect = f.session.connect("fake");
  f.socket.ready();
  await connect;
  expect(f.session.observation("Quoted untrusted host data", true)).toBe(true);
  expect(f.socket.sent.at(-1)).toEqual({
    type: "session.commentary.append",
    event_id: "live_context_1",
    delegation_id: null,
    content: "Quoted untrusted host data",
  });
  expect(() => f.session.observation("💬".repeat(121))).toThrow();
  f.socket.event({ type: "session.closed" });
});

test("explicit quota and model errors are classified without leaking raw content or fallback", async () => {
  for (const code of ["insufficient_quota", "model_not_found", "rate_limit_exceeded", "invalid_api_key"]) {
    const errors: string[] = [];
    const f = fixture({ onError: (e) => errors.push(e) });
    const connect = f.session.connect("fake");
    f.socket.event({ type: "error", error: { code, message: "SECRET" } });
    await connect;
    expect(errors[0]).toContain("gpt-live-1");
    expect(errors[0]).not.toContain("SECRET");
    expect(f.endpoints).toHaveLength(1);
  }
});

test("GPT-Live cumulative usage and final billing event reach cost callback", async () => {
  const updates: unknown[] = [],
    closes: unknown[] = [];
  const { socket, session } = fixture({ onUsage: (u) => updates.push(u), onClosed: (ok, u) => closes.push([ok, u]) });
  const pending = session.connect("fake");
  socket.ready();
  await pending;
  socket.event({ type: "session.usage.updated", usage: { seconds: 12 } });
  socket.event({ type: "session.closed", usage: { seconds: 15 } });
  expect(updates).toEqual([{ seconds: 12 }]);
  expect(closes).toEqual([[true, { seconds: 15 }]]);
});

test("typed context stays distinct; append acknowledgments mark timeline delivery, not task or speech completion", async () => {
  const acknowledged: any[] = [];
  const { socket, session } = fixture({ onContextAppended: (ack) => acknowledged.push(ack) });
  const start = session.connect("fake");
  socket.ready();
  await start;
  expect(session.instructions("Speak briefly and ask for confirmation.")).toBe(true);
  expect(session.observation("The job is still running.")).toBe(true);
  expect(socket.sent.slice(-2)).toEqual([
    { type: "session.instructions.append", event_id: "live_context_1", delegation_id: null, content: "Speak briefly and ask for confirmation." },
    { type: "session.thinking.append", event_id: "live_context_2", delegation_id: null, content: "The job is still running." },
  ]);
  socket.event({ type: "session.instructions.appended", client_event_id: "unknown", start_ms: 10, end_ms: 20 });
  socket.event({ type: "session.commentary.appended", client_event_id: "live_context_1", start_ms: 10, end_ms: 20 });
  expect(acknowledged).toEqual([]);
  socket.event({ type: "session.instructions.appended", client_event_id: "live_context_1", start_ms: 10, end_ms: 20 });
  socket.event({ type: "session.instructions.appended", client_event_id: "live_context_1", start_ms: 10, end_ms: 20 });
  expect(acknowledged).toEqual([{ eventId: "live_context_1", type: "instructions", startMs: 10, endMs: 20 }]);
  const close = session.close();
  socket.event({ type: "session.closed" });
  await close;
});
