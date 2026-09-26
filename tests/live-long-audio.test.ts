import { describe, expect, test } from "bun:test";
import { MAX_PENDING_BYTES, PlaybackScheduler, type PlaybackClock } from "../src/live/playback";
import { OpenAIRealtimeSession, type RealtimeSocket } from "../src/live/openai-session";
import { VoiceSession } from "../src/live/session";
import type { LiveAdapter, LiveConnection, LiveParams, VoiceOrchestration } from "../src/live/types";

// The clock advances only when the producer has fed a packet and playback has
// had time to drain it. This distinguishes long streams from a stalled sink.
class Clock implements PlaybackClock {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.time;
  }
  setTimeout(fn: () => void, delay: number) {
    const id = ++this.next;
    this.timers.set(id, { at: this.time + delay, fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  }
  clearTimeout(id: ReturnType<typeof setTimeout>) {
    this.timers.delete(id as unknown as number);
  }
  advance(ms: number) {
    const end = this.time + ms;
    while (true) {
      const due = [...this.timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.time = due[1].at;
      this.timers.delete(due[0]);
      due[1].fn();
    }
    this.time = end;
  }
}
const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function playback() {
  const clock = new Clock();
  const errors: string[] = [];
  let frames = 0;
  const scheduler = new PlaybackScheduler({
    clock,
    send: async () => {
      frames++;
    },
    flush: async () => {},
    onError: (e) => errors.push(e.message),
  });
  scheduler.start();
  async function pace(seconds: number) {
    for (let i = 0; i < seconds * 50; i++) {
      clock.advance(20);
      await tick();
    }
  }
  return {
    scheduler,
    clock,
    errors,
    pace,
    get frames() {
      return frames;
    },
  };
}
const second = Buffer.alloc(48_000, 1).toString("base64");
class Socket implements RealtimeSocket {
  readyState = 1;
  events: any[] = [];
  listeners = new Map<string, ((event: any) => void)[]>();
  send(data: string) {
    this.events.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.fire("close", {});
  }
  addEventListener(type: "open" | "message" | "error" | "close", fn: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, event: any) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  message(data: object) {
    this.fire("message", { data: JSON.stringify(data) });
  }
}
async function openai(orchestration?: VoiceOrchestration) {
  const pipe = playback();
  const socket = new Socket();
  const errors: string[] = [];
  const session = new OpenAIRealtimeSession(
    {
      onAudio: (data, epoch) => pipe.scheduler.enqueue(Buffer.from(data, "base64"), epoch),
      onInterrupted: (epoch) => pipe.scheduler.interrupt(epoch),
      getPlayedAudioMs: () => pipe.scheduler.playedMs,
      onError: (e) => errors.push(e.code),
    },
    () => socket,
    orchestration,
  );
  const ready = session.connect("fake");
  socket.fire("open", {});
  socket.message({ type: "session.updated" });
  await ready;
  return { pipe, socket, errors, session };
}

function response(socket: Socket, id: string) {
  const item = "audio-" + id;
  socket.message({ type: "response.created", response: { id } });
  socket.message({ type: "response.output_item.added", response_id: id, item: { id: item, type: "message" } });
  return () => socket.message({ type: "response.output_audio.delta", response_id: id, item_id: item, delta: second });
}
async function stream(push: () => void, pipe: ReturnType<typeof playback>, seconds: number) {
  for (let i = 0; i < seconds; i++) {
    push();
    await pipe.pace(1);
    expect(pipe.errors).toEqual([]);
    expect(pipe.scheduler.state.pendingBytes).toBeLessThan(48_000);
  }
}

describe("long paced generated audio", () => {
  test("OpenAI accepts >48 seconds within one response", async () => {
    const h = await openai();
    await stream(response(h.socket, "long"), h.pipe, 49);
    expect(h.session.state).toBe("ready");
    expect(h.errors).toEqual([]);
    expect(h.pipe.frames).toBeGreaterThan(2400);
    h.session.close();
    h.pipe.scheduler.close();
  });
  test("OpenAI completed responses and tool continuation do not share an audio budget", async () => {
    const h = await openai({
      tools: [{ name: "session_context", parametersJsonSchema: { type: "object" } }],
      userTranscript: () => {},
      execute: async () => ({ content: [{ type: "text", text: "done" }] }),
    });
    await stream(response(h.socket, "tool"), h.pipe, 25);
    h.socket.message({
      type: "response.function_call_arguments.done",
      response_id: "tool",
      call_id: "context",
      name: "session_context",
      arguments: "{}",
    });
    h.socket.message({ type: "response.done", response: { id: "tool", status: "completed" } });
    await Bun.sleep(0);
    expect(h.socket.events.some((e) => e.type === "response.create")).toBe(true);
    await stream(response(h.socket, "continued"), h.pipe, 25);
    h.socket.message({ type: "response.done", response: { id: "continued", status: "completed" } });
    await stream(response(h.socket, "another-turn"), h.pipe, 2);
    expect(h.session.state).toBe("ready");
    expect(h.errors).toEqual([]);
    h.session.close();
    h.pipe.scheduler.close();
  });
  test("OpenAI VAD revisions and a failed response cannot poison later paced audio", async () => {
    const h = await openai();
    await stream(response(h.socket, "old"), h.pipe, 25);
    h.socket.message({ type: "input_audio_buffer.speech_started", item_id: "user-next" });
    h.socket.message({ type: "response.done", response: { id: "old", status: "cancelled" } });
    await stream(response(h.socket, "failed"), h.pipe, 47);
    h.socket.message({ type: "response.done", response: { id: "failed", status: "failed" } });
    await stream(response(h.socket, "fresh"), h.pipe, 2);
    expect(h.session.state).toBe("ready");
    expect(h.pipe.errors).toEqual([]);
    expect(h.errors).toEqual(["transport_error"]);
    h.session.close();
    h.pipe.scheduler.close();
  });
  test("OpenAI still rejects malformed, empty, odd and oversized output packets", async () => {
    for (const delta of ["!!!", "", Buffer.alloc(3).toString("base64"), Buffer.alloc(96002).toString("base64")]) {
      const h = await openai();
      response(h.socket, "bad");
      h.socket.message({ type: "response.output_audio.delta", response_id: "bad", item_id: "audio-bad", delta });
      expect(h.errors).toEqual(["invalid_audio"]);
      expect(h.session.state).toBe("closed");
      expect(h.pipe.frames).toBe(0);
      h.pipe.scheduler.close();
    }
  });
  test("Gemini accepts long paced audio and a new turn after interruption", async () => {
    const pipe = playback();
    const errors: string[] = [];
    let params!: LiveParams;
    let ready!: (connection: LiveConnection) => void;
    const adapter: LiveAdapter = () =>
      ({
        live: {
          connect: (p: LiveParams) => {
            params = p;
            return new Promise<LiveConnection>((resolve) => {
              ready = resolve;
            });
          },
        },
      }) as ReturnType<LiveAdapter>;
    const session = new VoiceSession(
      {
        onAudio: (data, epoch) => pipe.scheduler.enqueue(Buffer.from(data, "base64"), epoch),
        onInterrupted: (epoch) => pipe.scheduler.interrupt(epoch),
        onError: (e) => errors.push(e.code),
      },
      adapter,
    );
    const connecting = session.connect("fake");
    ready({ close() {} } as LiveConnection);
    await connecting;
    const packet = (data = second) =>
      params.callbacks.onmessage({
        serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data } }] } },
      } as Parameters<LiveParams["callbacks"]["onmessage"]>[0]);
    for (let i = 0; i < 49; i++) {
      packet();
      await pipe.pace(1);
    }
    expect(errors).toEqual([]);
    expect(session.state).toBe("ready");
    params.callbacks.onmessage({ serverContent: { interrupted: true } } as Parameters<
      LiveParams["callbacks"]["onmessage"]
    >[0]);
    packet();
    await pipe.pace(1);
    expect(errors).toEqual([]);
    expect(pipe.frames).toBeGreaterThan(2400);
    packet(Buffer.alloc(3).toString("base64")); // odd-length PCM remains invalid
    expect(errors).toContain("invalid_audio");
    session.close();
    pipe.scheduler.close();
  });
});

test("stalled playback retains only the pending budget regardless of generated duration", () => {
  const errors: string[] = [];
  let writes = 0;
  const scheduler = new PlaybackScheduler({
    clock: new Clock(),
    send: () => {
      writes++;
      return new Promise<void>(() => {});
    },
    flush: async () => {},
    onError: (error) => errors.push(error.message),
  });
  scheduler.start();
  const packet = Buffer.alloc(48_000);
  for (let i = 0; i < 60; i++) expect(scheduler.enqueue(packet, 0)).toBe(true);
  expect(writes).toBe(1);
  expect(scheduler.state.inFlight).toBe(true);
  expect(scheduler.state.pendingBytes).toBe(MAX_PENDING_BYTES - 960);
  expect(scheduler.enqueue(packet, 0)).toBe(false);
  expect(scheduler.state.pendingBytes).toBe(MAX_PENDING_BYTES - 960);
  expect(errors).toEqual(["Local playback queue exceeds pending budget (2880000 bytes); audio incomplete"]);
  expect(scheduler.enqueue(packet, 0)).toBe(false);
  expect(errors).toHaveLength(1);
  scheduler.interrupt(1);
  expect(scheduler.state.pendingBytes).toBe(0);
  expect(scheduler.enqueue(packet, 0)).toBe(false); // stale epoch
  expect(scheduler.enqueue(packet, 1)).toBe(true); // overflow is recoverable at an explicit interruption
  scheduler.close();
  expect(scheduler.state.pendingBytes).toBe(0);
});
