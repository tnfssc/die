import { PlaybackScheduler, type PlaybackClock, type PlaybackState } from "./playback";

/** GPT-Live-only provisional acoustic activity detector. NOT voice classification or echo cancellation.
 * Processed capture from the native helper: 16 kHz mono signed little-endian PCM, 20 ms/frame.
 * Always forward the original capture to the server independently of this helper. */
export class GptLiveSpeechDetector {
  private active = false;
  private loudFrames = 0;
  private quietFrames = 0;
  get speaking(): boolean {
    return this.active;
  }

  /** Returns a transition, not one event per amplitude measurement. */
  observe(pcm: Buffer): "started" | "ended" | undefined {
    if (!Buffer.isBuffer(pcm) || pcm.length !== 640) throw new Error("Expected 20ms PCM16 mono 16k capture");
    let energy = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      const sample = pcm.readInt16LE(i) / 32768;
      energy += sample * sample;
    }
    const rms = Math.sqrt(energy / 320);
    // Conservative fixed thresholds; noise/echo may still trip this heuristic.
    if (!this.active) {
      this.loudFrames = rms >= 0.032 ? this.loudFrames + 1 : 0; // ~ -30 dBFS, 80 ms sustained
      if (this.loudFrames < 4) return;
      this.active = true;
      this.quietFrames = 0;
      return "started";
    }
    this.quietFrames = rms < 0.013 ? this.quietFrames + 1 : 0; // ~ -38 dBFS, 300 ms quiet
    if (this.quietFrames < 15) return;
    this.active = false;
    this.loudFrames = 0;
    return "ended";
  }
}

/** Bounded GPT-Live WS output. With no server output response boundary, interruption or
 * overflow latches output OFF until an explicit user-visible retry/reset after silence.
 * Reset does not prove that subsequent WS chunks are fresh: caller must discard old output
 * or create a fresh session/response before invoking it. Never gates mic capture. */
export class GptLivePlaybackRecovery {
  readonly detector = new GptLiveSpeechDetector();
  readonly scheduler: PlaybackScheduler;
  private muted = false;
  private outputSeen = false;
  private closed = false;
  private generation = 0;
  private readonly onError: (error: Error) => void;

  constructor(options: {
    send(frame: Buffer, generation: number): Promise<void>;
    flush(generation: number): Promise<void>;
    onError(error: Error): void;
    clock?: PlaybackClock;
    onState?: (state: PlaybackState) => void;
  }) {
    this.onError = options.onError;
    this.scheduler = new PlaybackScheduler({
      ...options,
      onError: (error) => {
        this.onError(error);
        this.suppress();
      },
      maxPendingBytes: 9_600,
    }); // 200ms @24k PCM16
  }
  get epoch(): number {
    return this.generation;
  }
  get needsRetry(): boolean {
    return this.muted;
  }
  get speaking(): boolean {
    return this.detector.speaking;
  }
  start(): void {
    this.scheduler.start();
  }
  capture(pcm: Buffer): "started" | "ended" | undefined {
    if (this.closed) return;
    const transition = this.detector.observe(pcm);
    if (transition === "started" && this.outputSeen) this.suppress();
    return transition;
  }
  /** PCM16 mono 24k. Enqueue only if this is the current output response. */
  output(pcm: Buffer): boolean {
    if (this.closed || this.muted) return false;
    // Even the first output overlapping speech has uncertain attribution.
    if (this.speaking) {
      this.suppress();
      return false;
    }
    if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2) {
      this.onError(new Error("Invalid GPT-Live PCM16 output"));
      return false;
    }
    this.outputSeen = true;
    if (this.scheduler.enqueue(pcm, this.generation)) {
      // Flush a short trailing frame; this is NOT a provider turn-complete event.
      this.scheduler.turnComplete(this.generation);
      return true;
    }
    if (!this.muted) {
      this.onError(new Error("GPT-Live playback rejected; explicit retry required"));
      this.suppress();
    }
    return false;
  }
  /** Must be called only after a fresh response/session is explicitly established. */
  resetForFreshResponse(): boolean {
    if (this.closed || this.speaking || !this.muted) return false;
    // Flush once more so old native writes cannot be mistaken for this response.
    this.generation++;
    this.scheduler.interrupt(this.generation);
    this.muted = false;
    this.outputSeen = false;
    return true;
  }
  private suppress(): void {
    if (this.muted || this.closed) return;
    this.muted = true;
    this.generation++;
    this.scheduler.interrupt(this.generation);
  }
  close(): void {
    this.closed = true;
    this.muted = true;
    this.scheduler.close();
  }
}
