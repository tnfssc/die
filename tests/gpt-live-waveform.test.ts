import { expect, test } from "bun:test";
import { GptLivePlaybackRecovery } from "../src/live/gpt-live-playback";
import { InputResampler } from "../src/live/openai-resample";

// Nonzero samples reveal byte loss/duplication that silence-only fixtures cannot.
function tone(samples: number, rate: number, amplitude = 10000): Buffer {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    pcm.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * 437 * i) / rate)), i * 2);
  return pcm;
}
const settle = async () => {
  for (let i = 0; i < 32; i++) await Promise.resolve();
};

function harness() {
  let now = 0,
    serial = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sent: Buffer[] = [];
  const flushes: number[] = [];
  const errors: string[] = [];
  const playback = new GptLivePlaybackRecovery({
    clock: {
      now: () => now,
      setTimeout: (fn, ms) => {
        const id = ++serial;
        timers.set(id, { at: now + ms, fn });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (id) => {
        timers.delete(id as unknown as number);
      },
    },
    send: async (pcm) => {
      sent.push(Buffer.from(pcm));
    },
    flush: async (epoch) => {
      flushes.push(epoch);
    },
    onError: (error) => {
      errors.push(error.message);
    },
  });
  playback.start();
  return {
    playback,
    sent,
    flushes,
    errors,
    advance: async (ms: number) => {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
      await settle();
    },
  };
}

test("continuous GPT waveform survives irregular aligned wire chunks byte-for-byte", async () => {
  const h = harness();
  const pcm = tone(24000, 24000);
  // Boundaries intentionally are not 20ms native frame boundaries.
  const sizes = [2, 478, 962, 1440, 318, 1920];
  let offset = 0,
    part = 0;
  while (offset < pcm.length) {
    const end = Math.min(pcm.length, offset + sizes[part++ % sizes.length]);
    expect(h.playback.output(pcm.subarray(offset, end))).toBe(true);
    await settle();
    await h.advance((end - offset) / 48);
    offset = end;
  }
  for (let i = 0; i < 20; i++) await h.advance(20);
  expect(Buffer.concat(h.sent).equals(pcm)).toBe(true);
  expect(h.sent.every((frame) => frame.length % 2 === 0 && frame.length <= 960)).toBe(true);
  expect(h.flushes).toEqual([]);
  expect(h.errors).toEqual([]);
  h.playback.close();
});

test("continuous local speech causes one flush, not a repeated per-frame crackle loop", async () => {
  const h = harness();
  const speech = tone(320, 16000);
  const silence = Buffer.alloc(640);
  h.playback.output(tone(480, 24000));
  await settle();
  for (let i = 0; i < 100; i++) h.playback.capture(speech);
  expect(h.flushes).toEqual([1]);
  expect(h.playback.output(tone(480, 24000))).toBe(false);
  // Capture-based release: 300ms detector quiet then 200ms guard.
  for (let i = 0; i < 24; i++) h.playback.capture(silence);
  expect(h.playback.suppressed).toBe(true);
  h.playback.capture(silence);
  expect(h.playback.suppressed).toBe(false);
  const resumed = tone(480, 24000, 7000);
  expect(h.playback.output(resumed)).toBe(true);
  await settle();
  expect(h.sent.at(-1)).toEqual(resumed);
  expect(h.flushes).toEqual([1]);
  expect(h.errors).toEqual([]);
  h.playback.close();
});

test("processed 20ms capture frames resample identically to continuous PCM with no chunk spikes", () => {
  const input = tone(16000, 16000);
  const framed = new InputResampler();
  const blocks: Buffer[] = [];
  for (let offset = 0; offset < input.length; offset += 640)
    blocks.push(Buffer.from(framed.push(input.subarray(offset, offset + 640))));
  blocks.push(Buffer.from(framed.flush()));
  const actual = Buffer.concat(blocks);
  const continuous = new InputResampler();
  const expected = Buffer.concat([Buffer.from(continuous.push(input)), Buffer.from(continuous.flush())]);
  expect(actual).toEqual(expected);
  expect(actual.length).toBe(48000);
  let maxError = 0,
    maxStep = 0;
  // Exclude final held sample: interpolation needs future input there.
  for (let i = 1; i < 23999; i++) {
    const value = actual.readInt16LE(i * 2);
    const ideal = 10000 * Math.sin((2 * Math.PI * 437 * i) / 24000);
    maxError = Math.max(maxError, Math.abs(value - ideal));
    maxStep = Math.max(maxStep, Math.abs(value - actual.readInt16LE((i - 1) * 2)));
  }
  expect(maxError).toBeLessThan(40); // <0.13% full scale, linear interpolation error
  expect(maxStep).toBeLessThan(1150); // no extra frame-boundary discontinuity
});
