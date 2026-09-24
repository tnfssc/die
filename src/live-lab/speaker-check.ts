/** Opt-in local speaker diagnostic; no PCM persists, no provider or network. Not an AEC/double-talk verdict. */
import type { AudioCallbacks, LiveLabAudio } from "./audio";

export type SpeakerCheckAudioFactory = (
  callbacks: AudioCallbacks,
  signal: AbortSignal,
) => Promise<Pick<LiveLabAudio, "start" | "play" | "flush" | "stop" | "close" | "diagnostics">>;
export type SpeakerCheckResult = {
  status: "correlated_return" | "no_correlated_return" | "no_signal" | "clipping" | "inconclusive";
  correlation?: number;
  /** Lag relative to first submitted playback frame, not measured speaker output latency. */
  lagMs?: number;
  /** Linear projection of capture onto reference at best lag; not ERLE or absolute AEC quality. */
  correlatedDbfs?: number;
  /** Sign of the matched waveform; present only for a correlated return. */
  polarity?: "normal" | "inverted";
  baselineDbfs?: number;
  playbackDbfs?: number;
  tailDbfs?: number;
  reason?: "insufficient_capture" | "low_reference" | "high_background" | "capture_overflow" | "playback_pending";
  /** Native configuration only, not evidence of AEC performance. Absent means unknown. */
  processing?: {
    voiceProcessingEnabled: boolean;
    voiceProcessingBypassed: boolean;
    captureRate: number;
    renderRate: number;
    captureChannels?: number;
    renderChannels?: number;
  };
};
const RATE = 16000,
  RENDER_RATE = 24000,
  BASE_MS = 600,
  PLAY_MS = 1000,
  TAIL_MS = 700,
  FRAME_MS = 100;
const MAX_SAMPLES = RATE * 4;
const abortError = () => new Error("Speaker check aborted or timed out");
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });

/** Deterministic low amplitude, broadband syllabic probe, 16k PCM16. */
export function speakerCheckReference(): Int16Array {
  const out = new Int16Array((RATE * PLAY_MS) / 1000);
  let seed = 0x6d2b79f5,
    smooth = 0;
  for (let i = 0; i < out.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    smooth = 0.68 * smooth + 0.32 * (((seed >>> 0) / 0xffffffff) * 2 - 1);
    const envelope = 0.32 + 0.68 * Math.sin((Math.PI * i) / 2400) ** 2;
    const fade = Math.min(1, i / 160, (out.length - 1 - i) / 160);
    out[i] = Math.round(smooth * envelope * fade * 1400);
  }
  return out;
}
function dbfs(a: Int16Array): number {
  if (!a.length) return -120;
  let power = 0;
  for (const x of a) power += x * x;
  return Math.round(Math.max(-120, 20 * Math.log10(Math.sqrt(power / a.length) / 32768)) * 10) / 10;
}
function clipped(a: Int16Array): boolean {
  let hits = 0;
  for (const x of a) if (Math.abs(x) >= 32000) hits++;
  return hits > a.length * 0.001;
}
/** Full-rate, phase-independent normalized lag search at 16 kHz. Caller splits capture
 * at the first playback submission; lag is relative to that boundary, not a render tap.
 * Search is limited to 450ms lag, 1s reference and a 4s capture cap.
 */
export function analyzeSpeakerCheck(
  baseline: Int16Array,
  playbackAndTail: Int16Array,
  reference: Int16Array,
): Omit<SpeakerCheckResult, "processing"> {
  const baselineDbfs = dbfs(baseline);
  const playbackDbfs = dbfs(playbackAndTail.subarray(0, Math.min(reference.length, playbackAndTail.length)));
  const tailDbfs = dbfs(playbackAndTail.subarray(Math.min(reference.length, playbackAndTail.length)));
  const levels = { baselineDbfs, playbackDbfs, tailDbfs };
  if (baseline.length < RATE * 0.35 || playbackAndTail.length < reference.length + RATE * 0.4)
    return { status: "inconclusive", reason: "insufficient_capture", ...levels };
  if (clipped(baseline) || clipped(playbackAndTail)) return { status: "clipping", ...levels };
  if (dbfs(reference) < -65) return { status: "inconclusive", reason: "low_reference", ...levels };
  if (playbackDbfs < -68 && tailDbfs < -68 && baselineDbfs < -68) return { status: "no_signal", ...levels };
  if (baselineDbfs > -24) return { status: "inconclusive", reason: "high_background", ...levels };
  let referenceEnergy = 0;
  for (let i = 0; i < reference.length; i++) referenceEnergy += reference[i]! ** 2;
  let best = 0,
    bestLag = 0,
    bestSign = 1,
    bestEnergy = 0;
  const maxLag = Math.min(RATE * 0.45, playbackAndTail.length - reference.length);
  // Search every sample: stepping the reference or lag by four misses some phases
  // altogether (and can mistake a decimation alias for a matching waveform).
  for (let lag = 0; lag <= maxLag; lag++) {
    let dot = 0,
      energy = 0;
    for (let i = 0; i < reference.length; i++) {
      const value = playbackAndTail[lag + i]!;
      dot += reference[i]! * value;
      energy += value * value;
    }
    const correlation = energy ? dot / Math.sqrt(referenceEnergy * energy) : 0;
    if (Math.abs(correlation) > best) {
      best = Math.abs(correlation);
      bestSign = Math.sign(correlation);
      bestLag = lag;
      bestEnergy = energy;
    }
  }
  const correlation = Math.round(best * 1000) / 1000;
  const matched = correlation >= 0.35 && playbackDbfs > baselineDbfs + 3;
  return {
    status: matched ? "correlated_return" : "no_correlated_return",
    correlation,
    lagMs: Math.round((bestLag / RATE) * 1000),
    correlatedDbfs:
      Math.round(Math.max(-120, 20 * Math.log10((best * Math.sqrt(bestEnergy / reference.length)) / 32768)) * 10) / 10,
    ...(matched ? { polarity: bestSign < 0 ? ("inverted" as const) : ("normal" as const) } : {}),
    ...levels,
  };
}

/** Only call after explicit consent. Factory is exactly LabDependencies.audio's signature.
 * 6s deadline, bounded capture and stop, zero PCM finally; no recordings or raw samples returned.
 */
export async function runSpeakerCheck(
  audioFactory: SpeakerCheckAudioFactory,
  signal: AbortSignal,
): Promise<SpeakerCheckResult> {
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const deadline = setTimeout(() => controller.abort(), 6000);
  const pcm = new Int16Array(MAX_SAMPLES),
    reference = speakerCheckReference();
  const frame = Buffer.alloc(((RENDER_RATE * FRAME_MS) / 1000) * 2);
  let length = 0,
    closed = false,
    accepting = true,
    overflow = false,
    queuedMs = 0,
    failure: Error | undefined;
  let audio: Awaited<ReturnType<SpeakerCheckAudioFactory>> | undefined;
  const callbacks: AudioCallbacks = {
    capture(chunk) {
      if (!accepting) return;
      if (length + Math.floor(chunk.length / 2) > MAX_SAMPLES) overflow = true;
      const count = Math.min(Math.floor(chunk.length / 2), MAX_SAMPLES - length);
      for (let i = 0; i < count; i++) pcm[length + i] = chunk.readInt16LE(i * 2);
      length += count;
    },
    played: (ms) => {
      queuedMs = ms;
    },
    error: () => {
      failure = new Error("Speaker check audio helper failed");
      controller.abort();
    },
    closed: () => {
      closed = true;
      controller.abort();
    },
  };
  // Guard uncooperative factories and mocked/native writes. Listener removed on settle.
  const guarded = async <T>(promise: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) {
      void promise.catch(() => {});
      throw abortError();
    }
    let abort!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(abortError());
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([promise, interrupted]);
    } finally {
      controller.signal.removeEventListener("abort", abort);
    }
  };
  try {
    // Retain ownership of a factory that settles after timeout, even after this function returns.
    const launched = audioFactory(callbacks, controller.signal);
    void launched
      .then((late) => {
        if (controller.signal.aborted && late !== audio) {
          try {
            late.close();
          } catch {}
        }
      })
      .catch(() => {});
    audio = await guarded(launched);
    await guarded(audio.start());
    await sleep(BASE_MS, controller.signal);
    const playStart = length;
    for (let part = 0; part < PLAY_MS / FRAME_MS; part++) {
      for (let j = 0; j < frame.length / 2; j++) {
        const position = (((part * frame.length) / 2 + j) * RATE) / RENDER_RATE;
        const index = Math.floor(position),
          fraction = position - index;
        const value =
          (reference[index] ?? 0) * (1 - fraction) + (reference[index + 1] ?? reference[index] ?? 0) * fraction;
        frame.writeInt16LE(Math.round(value), j * 2);
      }
      await guarded(audio.play(frame, 0));
      await sleep(FRAME_MS, controller.signal);
    }
    await sleep(TAIL_MS, controller.signal);
    if (controller.signal.aborted) throw abortError();
    const result = analyzeSpeakerCheck(
      pcm.subarray(Math.max(0, playStart - (BASE_MS * RATE) / 1000), playStart),
      pcm.subarray(playStart, length),
      reference,
    );
    const native = audio.diagnostics.ready;
    const ready =
      native &&
      typeof native.voiceProcessingEnabled === "boolean" &&
      typeof native.voiceProcessingBypassed === "boolean" &&
      Number.isInteger(native.captureRate) &&
      native.captureRate >= 8000 &&
      native.captureRate <= 192000 &&
      Number.isInteger(native.renderRate) &&
      native.renderRate >= 8000 &&
      native.renderRate <= 192000
        ? native
        : undefined;
    return {
      ...(overflow
        ? { status: "inconclusive" as const, reason: "capture_overflow" as const }
        : queuedMs > 100
          ? { status: "inconclusive" as const, reason: "playback_pending" as const }
          : result),
      ...(ready
        ? {
            processing: {
              voiceProcessingEnabled: ready.voiceProcessingEnabled,
              voiceProcessingBypassed: ready.voiceProcessingBypassed,
              captureRate: ready.captureRate,
              renderRate: ready.renderRate,
              ...(Number.isInteger(ready.captureChannels) && ready.captureChannels! > 0 && ready.captureChannels! <= 256
                ? { captureChannels: ready.captureChannels }
                : {}),
              ...(Number.isInteger(ready.renderChannels) && ready.renderChannels! > 0 && ready.renderChannels! <= 256
                ? { renderChannels: ready.renderChannels }
                : {}),
            },
          }
        : {}),
    };
  } catch {
    throw failure ?? (controller.signal.aborted ? abortError() : new Error("Speaker check audio failed"));
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", onAbort);
    controller.abort();
    accepting = false;
    const ownedAudio = audio;
    if (ownedAudio && !closed) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(() => ownedAudio.stop()),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 300);
          }),
        ]);
      } catch {
        /* close below */
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    try {
      audio?.close();
    } catch {
      /* best effort */
    }
    pcm.fill(0);
    reference.fill(0);
    frame.fill(0);
  }
}
