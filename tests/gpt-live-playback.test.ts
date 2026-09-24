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
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

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
      send: async (pcm, generation) => { sent.push({ pcm, generation }); },
      flush: async (generation) => { flushed.push(generation); },
      onError: (error) => { errors.push(error.message); },
    });
    playback.start();
    return { playback, sent, flushed, errors };
  }
  test("speech flushes pending PCM, drops output during speech and after quiet until explicit fresh response", async () => {
    const h = harness();
    expect(h.playback.output(output())).toBe(true);
    await tick();
    for (let i = 0; i < 3; i++) expect(h.playback.capture(loud)).toBeUndefined();
    expect(h.playback.capture(loud)).toBe("started");
    expect(h.playback.needsRetry).toBe(true);
    expect(h.playback.epoch).toBe(1);
    expect(h.flushed).toEqual([1]);
    expect(h.playback.resetForFreshResponse()).toBe(false);
    expect(h.playback.output(output())).toBe(false);
    for (let i = 0; i < 15; i++) h.playback.capture(quiet);
    expect(h.playback.speaking).toBe(false);
    expect(h.playback.output(output())).toBe(false); // quiet/ack alone isn't an old/new boundary
    expect(h.playback.resetForFreshResponse()).toBe(true);
    expect(h.playback.epoch).toBe(2);
    expect(h.flushed).toEqual([1, 2]);
    await tick();
    expect(h.playback.output(output())).toBe(true);
    await tick();
    expect(h.sent.at(-1)?.generation).toBe(2);
    h.playback.close();
  });
  test("overflow fails closed and flushes; cannot accumulate seconds of queued PCM", () => {
    const h = harness();
    expect(h.playback.output(Buffer.alloc(9_600))).toBe(true);
    expect(h.playback.output(output())).toBe(true); // first 20ms already in flight
    expect(h.playback.output(output())).toBe(false);
    expect(h.playback.needsRetry).toBe(true);
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
    expect(h.playback.needsRetry).toBe(false);
    h.playback.close();
  });
});
