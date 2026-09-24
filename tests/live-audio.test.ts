import { test, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { LiveAudio } from "../src/live/audio";
class Fake extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  writes: string[] = [];
  constructor() {
    super();
    this.stdin.on("data", (data) => this.writes.push(String(data)));
  }
  emitMessage(message: object) {
    this.stdout.write(JSON.stringify(message) + "\n");
  }
  kill() {
    this.killed = true;
    return true;
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function open(options: Record<string, unknown> = {}) {
  const worker = new Fake();
  const promise = LiveAudio.launch({ worker: worker as never, ...options });
  worker.emitMessage({ type: "hello", protocol: 1 });
  return { audio: await promise, worker };
}
async function running(options: Record<string, unknown> = {}) {
  const { audio, worker } = await open(options);
  const start = audio.start();
  await tick();
  worker.emitMessage({ type: "ready" });
  await start;
  return { audio, worker };
}
test("hello does not start mic; start waits ready, capture fixed 20ms and playback metadata", async () => {
  const frames: Buffer[] = [];
  const { audio, worker } = await open({ callbacks: { capture: (b: Buffer) => frames.push(b) } });
  expect(worker.writes).toEqual([]);
  const start = audio.start();
  await tick();
  expect(worker.writes).toEqual(['{"type":"start"}\n']);
  worker.emitMessage({ type: "ready" });
  await start;
  worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64") });
  worker.emitMessage({ type: "played", queuedMs: 20 });
  expect(frames).toHaveLength(1);
  expect(audio.diagnostics).toEqual({ queuedMs: 20, captureFrames: 1, capturedBytes: 640 });
  await audio.play(Buffer.alloc(960), 0);
  await audio.flush(1);
  expect(worker.writes.slice(1).map((x) => JSON.parse(x).type)).toEqual(["play", "flush"]);
  await expect(audio.play(Buffer.alloc(960), 0)).rejects.toThrow("Stale");
  const stop = audio.stop();
  await tick();
  worker.emitMessage({ type: "stopped" });
  await stop;
  expect(worker.killed).toBe(true);
  worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64") });
  expect(frames).toHaveLength(1);
});
test("handshake mismatch, timeout, exit, and late events close process", async () => {
  const worker = new Fake();
  const launch = LiveAudio.launch({ worker: worker as never, helloTimeoutMs: 20 });
  worker.emitMessage({ type: "hello", protocol: 2 });
  await expect(launch).rejects.toThrow();
  expect(worker.killed).toBe(true);
  const second = new Fake();
  await expect(LiveAudio.launch({ worker: second as never, helloTimeoutMs: 10 })).rejects.toThrow("timed out");
  expect(second.killed).toBe(true);
  const { audio, worker: third } = await open({ startTimeoutMs: 10 });
  await expect(audio.start()).rejects.toThrow("timed out");
  expect(third.killed).toBe(true);
});
test("reject oversized, malformed, truncated and invalid capture; sanitize helper errors", async () => {
  for (const message of [
    "x".repeat(65537),
    JSON.stringify({ type: "capture", data: "!!!" }),
    JSON.stringify({ type: "capture", data: Buffer.alloc(4).toString("base64") }),
  ]) {
    const { audio, worker } = await running();
    worker.stdout.write(message + "\n");
    expect(worker.killed).toBe(true);
    await expect(audio.play(Buffer.alloc(4), 0)).rejects.toThrow();
  }
  const seen: string[] = [];
  const { worker } = await running({ callbacks: { error: (_: string, msg: string) => seen.push(msg) } });
  worker.stderr.write("secret token");
  worker.emitMessage({ type: "error", code: "BAD_DEVICE", message: "secret token" });
  expect(seen).toEqual(["Audio helper reported an error"]);
  expect(worker.killed).toBe(true);
});
test("FIFO and bounded pending input under stalled backpressure", async () => {
  const { audio, worker } = await running();
  // Freeze writes: no callback/drain means queue cannot grow without bound.
  (worker.stdin as unknown as { write: (...args: unknown[]) => boolean }).write = () => false;
  const pending = audio.play(Buffer.alloc(9600), 0);
  const queued = Array.from({ length: 12 }, () => audio.play(Buffer.alloc(9600), 0).catch((e) => e.message));
  expect(await Promise.all(queued.slice(6))).toContain("Audio helper input queue full");
  audio.close();
  await expect(pending).rejects.toThrow("closed");
  await Promise.all(queued);
});
test("process exit during active write and invalid generation", async () => {
  const { audio, worker } = await running();
  await expect(audio.flush(0)).rejects.toThrow("increase");
  await expect(audio.play(Buffer.alloc(3), 0)).rejects.toThrow("frame");
  worker.emit("exit", 1);
  expect(worker.killed).toBe(true);
  await expect(audio.flush(2)).rejects.toThrow("not running");
});

test("stop timeout kills even if worker never acknowledges; malformed stdout is rejected", async () => {
  const { audio, worker } = await running({ stopTimeoutMs: 10 });
  await audio.stop();
  expect(worker.killed).toBe(true);
  const next = await running();
  next.worker.stdout.write("{not-json}\n");
  expect(next.worker.killed).toBe(true);
});

test("structured setup error preserves only bounded domain and numeric code", async () => {
  const seen: unknown[] = [];
  const { audio, worker } = await open({
    callbacks: {
      error: (code: string, message: string, setup?: { domain: string; number: number }) =>
        seen.push([code, message, setup]),
    },
  });
  const start = audio.start();
  worker.emitMessage({
    type: "error",
    code: "engine_start",
    domain: "NSOSStatusErrorDomain",
    number: -10875,
    message: "private device",
  });
  await expect(start).rejects.toThrow();
  expect(seen).toEqual([
    ["engine_start", "Audio helper reported an error", { domain: "NSOSStatusErrorDomain", number: -10875 }],
  ]);
  const other: unknown[] = [];
  const next = await open({
    callbacks: {
      error: (_code: string, _message: string, setup?: { domain: string; number: number }) => other.push(setup),
    },
  });
  const pending = next.audio.start();
  next.worker.emitMessage({
    type: "error",
    code: "tap_install",
    domain: "SECRET_TOKEN_123",
    number: 42,
    message: "private",
  });
  await expect(pending).rejects.toThrow();
  expect(other).toEqual([undefined]);
});

test("bounded native ready metadata and full-duplex capture during queued playback", async () => {
  const frames: Buffer[] = [];
  const { audio, worker } = await open({ callbacks: { capture: (b: Buffer) => frames.push(b) } });
  const started = audio.start();
  await tick();
  worker.emitMessage({
    type: "ready",
    voiceProcessingEnabled: true,
    voiceProcessingBypassed: false,
    captureRate: 48000,
    renderRate: 48000,
    secret: "discard",
  });
  await started;
  expect(audio.diagnostics.ready).toEqual({
    voiceProcessingEnabled: true,
    voiceProcessingBypassed: false,
    captureRate: 48000,
    renderRate: 48000,
  });
  await audio.play(Buffer.alloc(960), 0);
  worker.emitMessage({ type: "played", queuedMs: 200 });
  worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64") });
  expect(audio.diagnostics).toMatchObject({ queuedMs: 200, captureFrames: 1, capturedBytes: 640 });
  expect(frames).toHaveLength(1);
  audio.close();
  const invalid = await open();
  const waiting = invalid.audio.start();
  await tick();
  invalid.worker.emitMessage({
    type: "ready",
    voiceProcessingEnabled: "true",
    voiceProcessingBypassed: false,
    captureRate: Infinity,
    renderRate: 48000,
  });
  await waiting;
  expect(invalid.audio.diagnostics.ready).toBeUndefined();
  invalid.audio.close();
});

test("ready channel metadata is optional and independently sanitized", async () => {
  const base = {
    type: "ready",
    voiceProcessingEnabled: true,
    voiceProcessingBypassed: false,
    captureRate: 48000,
    renderRate: 48000,
  };
  for (const [channels, expected] of [
    [
      { captureChannels: 9, renderChannels: 2 },
      { captureChannels: 9, renderChannels: 2 },
    ],
    [{ captureChannels: 0, renderChannels: 1.5 }, {}],
    [{ captureChannels: Infinity, renderChannels: 257 }, {}],
    [{ captureChannels: "2", renderChannels: 1 }, { renderChannels: 1 }],
  ] as const) {
    const { audio, worker } = await open();
    const started = audio.start();
    await tick();
    worker.emitMessage({ ...base, ...channels });
    await started;
    expect(audio.diagnostics.ready).toEqual({
      voiceProcessingEnabled: true,
      voiceProcessingBypassed: false,
      captureRate: 48000,
      renderRate: 48000,
      ...expected,
    });
    audio.close();
  }
});
