import { describe, expect, test } from "bun:test";
import { GptLivePlaybackRecovery, GptLiveSpeechDetector } from "../src/live/gpt-live-playback";

function capture(level: number): Buffer {
  const b = Buffer.alloc(640);
  for (let i = 0; i < b.length; i += 2) b.writeInt16LE(level, i);
  return b;
}
const loud = capture(2300);
const soft = capture(700);
const quiet = capture(0);
const output = () => Buffer.alloc(960); // 20ms at 24k
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("GPT-Live processed capture activity (heuristic, not VAD)", () => {
  test("requires sustained speech and hysteretic quiet; no per-amplitude-tick transition", () => {
    const d = new GptLiveSpeechDetector();
    expect(d.observe(loud)).toBeUndefined();
    expect(d.observe(quiet)).toBeUndefined();
    for (let i = 0; i < 3; i++) expect(d.observe(loud)).toBeUndefined();
    expect(d.observe(loud)).toBe("started");
    for (let i = 0; i < 14; i++) expect(d.observe(quiet)).toBeUndefined();
    expect(d.speaking).toBe(true);
    expect(d.observe(soft)).toBeUndefined(); // insufficiently quiet: resets release counter
    for (let i = 0; i < 14; i++) expect(d.observe(quiet)).toBeUndefined();
    expect(d.observe(quiet)).toBe("ended");
    expect(d.speaking).toBe(false);
  });
  test("requires exact processed capture frame", () => {
    const d = new GptLiveSpeechDetector();
    expect(() => d.observe(Buffer.alloc(960))).toThrow();
    expect(() => d.observe(Buffer.alloc(639))).toThrow();
  });
});

describe("GPT-Live bounded playback recovery", () => {
  function harness() {
    const sent: Array<{ pcm: Buffer; generation: number }> = [];
    const flushed: number[] = [];
    const errors: string[] = [];
    const playback = new GptLivePlaybackRecovery({
      send: async (pcm, generation) => {
        sent.push({ pcm, generation });
      },
      flush: async (generation) => {
        flushed.push(generation);
      },
      onError: (error) => {
        errors.push(error.message);
      },
    });
    playback.start();
    return { playback, sent, flushed, errors };
  }
  test("speech flushes output, suppresses during speech and quiet guard, then automatically resumes arriving stream", async () => {
    const h = harness();
    expect(h.playback.output(output())).toBe(true);
    await tick();
    for (let i = 0; i < 3; i++) expect(h.playback.capture(loud)).toBeUndefined();
    expect(h.playback.capture(loud)).toBe("started");
    expect(h.playback.suppressed).toBe(true);
    expect(h.playback.epoch).toBe(1);
    expect(h.flushed).toEqual([1]);
    expect(h.playback.output(output())).toBe(false);
    for (let i = 0; i < 15; i++) h.playback.capture(quiet);
    expect(h.playback.speaking).toBe(false);
    expect(h.playback.suppressionReason).toBe("settling");
    for (let i = 0; i < 9; i++) h.playback.capture(quiet);
    expect(h.playback.output(output())).toBe(false);
    h.playback.capture(quiet);
    expect(h.playback.suppressed).toBe(false);
    // Same socket, no invented server marker or reset. New arriving bytes may
    // still be an old server tail: best effort, not proven generation attribution.
    expect(h.playback.output(output())).toBe(true);
    await tick();
    expect(h.sent.at(-1)?.generation).toBe(1);
    expect(h.flushed).toEqual([1]);
    h.playback.close();
  });
  test("overflow fails closed and flushes; cannot accumulate seconds of queued PCM", () => {
    const h = harness();
    expect(h.playback.output(Buffer.alloc(9_600))).toBe(true);
    expect(h.playback.output(output())).toBe(true); // first 20ms already in flight
    expect(h.playback.output(output())).toBe(false);
    expect(h.playback.suppressed).toBe(true);
    expect(h.playback.scheduler.state.pendingBytes).toBe(0);
    expect(h.flushed).toEqual([1]);
    expect(h.errors.some((e) => e.includes("pending budget"))).toBe(true);
    h.playback.close();
  });
  test("invalid output is rejected, but does not gate microphone or count as speech", () => {
    const h = harness();
    expect(h.playback.output(Buffer.alloc(1))).toBe(false);
    expect(h.playback.capture(quiet)).toBeUndefined();
    expect(h.playback.speaking).toBe(false);
    expect(h.playback.suppressionReason).toBe("error");
    h.playback.close();
  });
});

test("GPT-Live queue paces at most an 80ms native reserve even after a delayed timer", async () => {
  let now = 0,
    serial = 0;
  const timers = new Map<number, () => void>();
  const writes: number[] = [];
  const playback = new GptLivePlaybackRecovery({
    clock: {
      now: () => now,
      setTimeout: (fn) => {
        const id = ++serial;
        timers.set(id, fn);
        return id as any;
      },
      clearTimeout: (id) => {
        timers.delete(id as any);
      },
    },
    send: async () => {
      writes.push(now);
    },
    flush: async () => {},
    onError: () => {
      throw Error("unexpected");
    },
  });
  playback.start();
  playback.output(Buffer.alloc(9600));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(writes).toHaveLength(4);
  expect(playback.scheduler.state.nativeQueuedMs).toBe(80);
  expect(playback.scheduler.state.pendingBytes).toBe(5760);
  now = 500;
  const fire = [...timers.values()];
  timers.clear();
  fire.forEach((fn) => fn());
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(writes).toHaveLength(8); // no unlimited catch-up credit
  expect(playback.scheduler.state.nativeQueuedMs).toBe(80);
  for (let i = 0; i < 4; i++) playback.capture(loud);
  expect(playback.scheduler.state.pendingBytes).toBe(0);
  expect(timers.size).toBe(0);
  playback.close();
});

test("local interruption flushes immediately despite an outstanding native pipe write", async () => {
  let settle!: () => void;
  const flushes: number[] = [];
  let writes = 0;
  const playback = new GptLivePlaybackRecovery({
    send: () => {
      writes++;
      return new Promise((resolve) => {
        settle = resolve;
      });
    },
    flush: async (epoch) => {
      flushes.push(epoch);
    },
    onError: () => {
      throw Error("unexpected");
    },
  });
  playback.start();
  playback.output(Buffer.alloc(1920));
  for (let i = 0; i < 4; i++) playback.capture(loud);
  expect(flushes).toEqual([1]);
  expect(playback.scheduler.state.pendingBytes).toBe(0);
  settle();
  await tick();
  expect(writes).toBe(1);
  expect(playback.scheduler.playedMs).toBe(0);
  playback.close();
});

test("noise during settling resets the guard; renewed speech flushes again; no indefinite mute", async () => {
  const flushed: number[] = [];
  const p = new GptLivePlaybackRecovery({
    send: async () => {},
    flush: async (e) => {
      flushed.push(e);
    },
    onError: () => {},
  });
  p.start();
  for (let i = 0; i < 4; i++) p.capture(loud);
  for (let i = 0; i < 20; i++) p.capture(quiet);
  p.capture(soft); // below onset but above quiet threshold: reset short guard
  for (let i = 0; i < 9; i++) p.capture(quiet);
  expect(p.output(output())).toBe(false);
  for (let i = 0; i < 4; i++) p.capture(loud);
  expect(flushed).toEqual([1, 2]);
  for (let i = 0; i < 25; i++) p.capture(quiet);
  expect(p.suppressed).toBe(false);
  expect(p.output(output())).toBe(true);
  p.close();
});

test("hard output errors do not silently recover when capture becomes quiet", () => {
  const errors: string[] = [];
  const p = new GptLivePlaybackRecovery({
    send: async () => {},
    flush: async () => {},
    onError: (e) => errors.push(e.message),
  });
  p.start();
  expect(p.output(Buffer.alloc(1))).toBe(false);
  for (let i = 0; i < 50; i++) p.capture(quiet);
  expect(p.suppressionReason).toBe("error");
  expect(p.output(output())).toBe(false);
  expect(errors).toEqual(["Invalid GPT-Live PCM16 output"]);
  p.close();
});
