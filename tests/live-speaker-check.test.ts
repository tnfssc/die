import { expect, test } from "bun:test";
import type { AudioCallbacks } from "../src/live/audio";
import { analyzeSpeakerCheck, runSpeakerCheck, speakerCheckReference } from "../src/live/speaker-check";

const RATE = 16000;
const reference = speakerCheckReference();
const baseline = new Int16Array(RATE * 0.6);
function combined(lag = 1600, amplitude = 1): Int16Array {
  const out = new Int16Array(RATE * 1.7);
  for (let i = 0; i < reference.length; i++) out[i + lag] = Math.round(reference[i]! * amplitude);
  return out;
}
test("known delayed residual has normalized correlation and lag", () => {
  const result = analyzeSpeakerCheck(baseline, combined(), reference);
  expect(result.status).toBe("correlated_return");
  expect(result.correlation).toBeGreaterThan(0.95);
  expect(result.lagMs).toBe(100);
  let power = 0;
  for (const sample of reference) power += sample * sample;
  expect(result.correlatedDbfs).toBeCloseTo(20 * Math.log10(Math.sqrt(power / reference.length) / 32768), 0);
});
test("off-grid delays and inverted phase are detected without decimation aliases", () => {
  const lag = 1603;
  const inverted = analyzeSpeakerCheck(baseline, combined(lag, -1), reference);
  expect(inverted.status).toBe("correlated_return");
  expect(inverted.correlation).toBeGreaterThan(0.95);
  expect(inverted.polarity).toBe("inverted");
  expect(inverted.lagMs).toBe(100);

  // Reference energy on a phase skipped by a 4:1 decimated search.
  const sparse = new Int16Array(reference.length);
  let seed = 179;
  for (let i = 1; i < sparse.length; i += 4) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    sparse[i] = seed & 1 ? 1000 : -1000;
  }
  const captured = new Int16Array(RATE * 1.7);
  captured.set(sparse, 1603);
  const result = analyzeSpeakerCheck(baseline, captured, sparse);
  expect(result.status).toBe("correlated_return");
  expect(result.correlation).toBe(1);
  expect(result.polarity).toBe("normal");
  expect(result.lagMs).toBe(100);
});
test("uncorrelated broadband noise is not called echo", () => {
  let seed = 110;
  const noise = combined(0, 0);
  for (let i = 0; i < noise.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    noise[i] = Math.round(((seed >>> 0) / 0xffffffff) * 2000 - 1000);
  }
  const result = analyzeSpeakerCheck(baseline, noise, reference);
  expect(result.status).toBe("no_correlated_return");
  expect(result.correlation).toBeLessThan(0.35);
});
test("silence, clipping, missing capture and loud background are honest", () => {
  expect(analyzeSpeakerCheck(baseline, combined(0, 0), reference).status).toBe("no_signal");
  const clip = combined();
  clip.fill(32767, 0, 100);
  expect(analyzeSpeakerCheck(baseline, clip, reference).status).toBe("clipping");
  expect(analyzeSpeakerCheck(baseline.subarray(0, 10), combined(), reference).reason).toBe("insufficient_capture");
  expect(analyzeSpeakerCheck(new Int16Array(baseline.length).fill(2500), combined(), reference).reason).toBe(
    "high_background",
  );
});
function fakeAudio(
  callbacks: AudioCallbacks,
  options: { hang?: boolean; error?: boolean; stopHang?: boolean; capture?: boolean } = {},
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = 0,
    closed = 0,
    plays = 0;
  const audio = {
    diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
    async start() {
      if (options.error) {
        callbacks.error?.("fail", "private details");
        throw Error("private details");
      }
      if (options.hang) return new Promise<void>(() => {});
      if (options.capture) timer = setInterval(() => callbacks.capture?.(Buffer.alloc(640)), 20);
    },
    async play(frame: Buffer, gen: number) {
      expect(frame.length).toBe(4800);
      expect(gen).toBe(0);
      plays++;
    },
    async flush() {},
    stop() {
      stopped++;
      if (options.stopHang) return new Promise<void>(() => {});
      return Promise.resolve();
    },
    close() {
      closed++;
      if (timer) clearInterval(timer);
      callbacks.closed?.();
    },
  };
  return { audio, stats: () => ({ stopped, closed, plays }) };
}
test("runner uses only audio factory, returns sanitized summary, and closes", async () => {
  let fake: ReturnType<typeof fakeAudio> | undefined;
  const result = await runSpeakerCheck(async (cb, signal) => {
    expect(signal.aborted).toBe(false);
    fake = fakeAudio(cb, { capture: true });
    return fake.audio;
  }, new AbortController().signal);
  expect(result.status).toBe("no_signal");
  expect(Object.keys(result).sort()).toEqual(["baselineDbfs", "playbackDbfs", "status", "tailDbfs"]);
  expect(fake!.stats()).toEqual({ stopped: 1, closed: 1, plays: 10 });
});
test("abort during start and hung stop are bounded", async () => {
  const controller = new AbortController();
  const fake = fakeAudio({}, { hang: true, stopHang: true });
  const started = Date.now();
  const pending = runSpeakerCheck(async () => fake.audio, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await expect(pending).rejects.toThrow(/aborted/);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(fake.stats().closed).toBe(1);
  expect(fake.stats().stopped).toBe(1);
});
test("terminal native error is sanitized and closed", async () => {
  let fake: ReturnType<typeof fakeAudio>;
  await expect(
    runSpeakerCheck(async (callbacks) => {
      fake = fakeAudio(callbacks, { error: true });
      return fake.audio;
    }, new AbortController().signal),
  ).rejects.toThrow("Speaker check audio helper failed");
  expect(fake!.stats().closed).toBe(1);
});
test("aborted before launch never calls audio factory", async () => {
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  await expect(
    runSpeakerCheck(async () => {
      calls++;
      throw Error("must not launch");
    }, abort.signal),
  ).rejects.toThrow(/aborted/);
  expect(calls).toBe(0);
});

test("processing metadata is included only when validated", async () => {
  const result = await runSpeakerCheck(async (cb) => {
    const fake = fakeAudio(cb, { capture: true });
    return {
      ...fake.audio,
      diagnostics: {
        ...fake.audio.diagnostics,
        ready: {
          voiceProcessingEnabled: true,
          voiceProcessingBypassed: false,
          captureRate: 16000,
          renderRate: 24000,
          captureChannels: 9,
          renderChannels: 2,
        },
      },
    };
  }, new AbortController().signal);
  expect(result.processing).toEqual({
    voiceProcessingEnabled: true,
    voiceProcessingBypassed: false,
    captureRate: 16000,
    renderRate: 24000,
    captureChannels: 9,
    renderChannels: 2,
  });
});
test("late factory completion is closed after abort", async () => {
  const controller = new AbortController();
  let release!: (audio: ReturnType<typeof fakeAudio>["audio"]) => void;
  const promise = new Promise<ReturnType<typeof fakeAudio>["audio"]>((resolve) => {
    release = resolve;
  });
  const pending = runSpeakerCheck(async () => promise, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow(/aborted/);
  const late = fakeAudio({});
  release(late.audio);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(late.stats().closed).toBe(1);
});

test("capture overflow and pending playback remain inconclusive", async () => {
  const overflow = await runSpeakerCheck(async (cb) => {
    const fake = fakeAudio(cb);
    return {
      ...fake.audio,
      async start() {
        cb.capture?.(Buffer.alloc(2 * RATE * 5));
      },
    };
  }, new AbortController().signal);
  expect(overflow).toMatchObject({ status: "inconclusive", reason: "capture_overflow" });

  const pending = await runSpeakerCheck(async (cb) => {
    const fake = fakeAudio(cb, { capture: true });
    return {
      ...fake.audio,
      async play(frame: Buffer, gen: number) {
        await fake.audio.play(frame, gen);
        cb.played?.(500);
      },
    };
  }, new AbortController().signal);
  expect(pending).toMatchObject({ status: "inconclusive", reason: "playback_pending" });
});
test("abort interrupts an uncooperative playback write and closes owned audio", async () => {
  const abort = new AbortController();
  let started!: () => void;
  const playing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fake = fakeAudio({});
  const result = runSpeakerCheck(
    async () => ({
      ...fake.audio,
      play: async () => {
        started();
        await new Promise<void>(() => {});
      },
    }),
    abort.signal,
  );
  await playing;
  abort.abort();
  await expect(result).rejects.toThrow(/aborted/);
  expect(fake.stats()).toEqual({ stopped: 1, closed: 1, plays: 0 });
});

test("six-second deadline closes a hung start without external abort", async () => {
  const fake = fakeAudio({}, { hang: true });
  await expect(runSpeakerCheck(async () => fake.audio, new AbortController().signal)).rejects.toThrow(/timed out/);
  expect(fake.stats()).toEqual({ stopped: 1, closed: 1, plays: 0 });
}, 9000);

test("submitted PCM buffer is cleared after abort", async () => {
  const controller = new AbortController();
  let held: Buffer | undefined;
  const fake = fakeAudio({});
  await expect(
    runSpeakerCheck(
      async () => ({
        ...fake.audio,
        play: async (frame) => {
          held = frame;
          expect(frame.some((byte) => byte !== 0)).toBe(true);
          controller.abort();
        },
      }),
      controller.signal,
    ),
  ).rejects.toThrow(/aborted/);
  expect(held?.every((byte) => byte === 0)).toBe(true);
  expect(fake.stats().closed).toBe(1);
});
