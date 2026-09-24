import { PlaybackScheduler, type PlaybackClock, type PlaybackState } from "./playback";

/** GPT-Live-only provisional acoustic activity detector. NOT voice classification or echo cancellation.
 * Processed capture from the native helper: 16 kHz mono signed little-endian PCM, 20 ms/frame.
 * Always forward the original capture to the server independently of this helper. */
export class GptLiveSpeechDetector {
  private active = false;
  private loudFrames = 0;
  private quietFrames = 0;
  private quietFrame = true;
  get quiet(): boolean {
    return this.quietFrame;
  }
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
    this.quietFrame = rms < 0.013;
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

/** Bounded continuous GPT-Live output, with best-effort local interruption/recovery.
 * Drop output during qualified acoustic activity and 200ms additional captured quiet.
 * Resume NEW arriving stream chunks automatically; no remote old/new guarantee exists.
 * A stale server tail can therefore be heard after recovery. Never gates microphone. */
export class GptLivePlaybackRecovery {
  readonly detector = new GptLiveSpeechDetector();
  readonly scheduler: PlaybackScheduler;
  private muted = false;
  private faulted = false;
  private quietGuardFrames = 0;
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
      onError: (error) => this.fail(error),
      maxPendingBytes: 9_600,
    }); // 200ms pending @24k PCM16 plus bounded native reserve
  }
  get epoch(): number {
    return this.generation;
  }
  get suppressed(): boolean {
    return this.muted;
  }
  get speaking(): boolean {
    return this.detector.speaking;
  }
  get suppressionReason(): "speech" | "settling" | "error" | undefined {
    return this.faulted ? "error" : this.speaking ? "speech" : this.muted ? "settling" : undefined;
  }
  start(): void {
    this.scheduler.start();
  }
  capture(pcm: Buffer): "started" | "ended" | undefined {
    if (this.closed) return;
    const transition = this.detector.observe(pcm);
    if (transition === "started") {
      this.quietGuardFrames = 10;
      this.suppress(true);
    } else if (transition === "ended") {
      this.quietGuardFrames = 10; // after the detector's 300ms qualified quiet
    } else if (this.muted && !this.faulted && !this.speaking) {
      // The native helper continuously emits 20ms processed frames. Do not recover
      // from a stopped capture stream or from a short noisy gap inside speech.
      this.quietGuardFrames = this.detector.quiet ? this.quietGuardFrames - 1 : 10;
      if (this.quietGuardFrames <= 0) this.muted = false;
    }
    return transition;
  }
  /** PCM16 mono24k. Suppressed chunks are discarded, never queued for replay. */
  output(pcm: Buffer): boolean {
    if (this.closed || this.muted || this.speaking || this.faulted) return false;
    if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2) {
      this.fail(new Error("Invalid GPT-Live PCM16 output"));
      return false;
    }
    if (this.scheduler.enqueue(pcm, this.generation)) {
      // Drain short final frames; NOT a provider turn-complete event.
      this.scheduler.turnComplete(this.generation);
      return true;
    }
    if (!this.faulted) this.fail(new Error("GPT-Live playback rejected"));
    return false;
  }
  private fail(error: Error): void {
    if (this.closed || this.faulted) return;
    this.faulted = true;
    this.suppress();
    this.onError(error);
  }
  private suppress(force = false): void {
    if (this.closed || (this.muted && !force)) return;
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
