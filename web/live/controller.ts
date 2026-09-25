export type Phase = "idle" | "requesting-mic" | "connecting" | "ready" | "muted" | "ended" | "error";
export type LiveState = { phase: Phase; reason?: string };
// All PCM is binary, signed 16-bit little-endian mono. Capture: 16kHz; playback: 24kHz.
export interface Capture {
  onPcm16(cb: (frame: Uint8Array) => void): () => void;
  onError?(cb: (error: Error) => void): () => void;
  stop(): Promise<void> | void;
}
export interface MediaSource {
  acquire16k(signal: AbortSignal): Promise<Capture>;
}
export interface AudioOutput {
  readonly queuedBytes: number;
  enqueue24k(frame: Uint8Array): void;
  clear(): void;
  stop(): Promise<void> | void;
}
export type TransportMessage =
  | { type: "ready" | "interrupted" }
  | { type: "audio"; pcm16: Uint8Array }
  | { type: "closed" | "error"; reason?: string };
export interface Transport {
  readonly queuedBytes: number;
  onMessage(cb: (message: TransportMessage) => void): () => void;
  send16k(frame: Uint8Array): void;
  sendControl(control: { type: "mute"; muted: boolean } | { type: "end" }): void;
  close(): Promise<void> | void;
}
export interface TransportFactory {
  connect(signal: AbortSignal): Promise<Transport>;
}
const INPUT_FRAME_LIMIT = 3200,
  INPUT_LIMIT = 6400,
  OUTPUT_LIMIT = 12000;

/** Lifecycle owner. Adapters must bound their own queues, copy retained frames and make stop/close idempotent. */
export class BrowserLiveController {
  private value: LiveState = { phase: "idle" };
  private generation = 0;
  private disposed = false;
  private abort?: AbortController;
  private deadline?: ReturnType<typeof setTimeout>;
  private muted = false;
  private pending?: Promise<void>;
  private cleanupTask?: Promise<boolean>;
  private failedReleases: Array<() => Promise<void> | void> = [];
  private capture?: Capture;
  private transport?: Transport;
  private output?: AudioOutput;
  private offCapture?: () => void;
  private offCaptureError?: () => void;
  private offTransport?: () => void;
  private listeners = new Set<(state: LiveState) => void>();
  constructor(
    private media: MediaSource,
    private network: TransportFactory,
    private audio: () => AudioOutput,
  ) {}
  get state(): LiveState {
    return this.value;
  }
  subscribe(cb: (state: LiveState) => void): () => void {
    this.listeners.add(cb);
    cb(this.value);
    return () => {
      this.listeners.delete(cb);
    };
  }
  private setState(phase: Phase, reason?: string): void {
    this.value = { phase, ...(reason ? { reason } : {}) };
    for (const cb of [...this.listeners]) {
      try {
        cb(this.value);
      } catch {
        /* UI observer cannot retain microphone resources. */
      }
    }
  }
  private active(id: number): boolean {
    return !this.disposed && this.generation === id;
  }
  /** Resolves after setup; only the server's ready message makes the session ready. */
  start(): Promise<void> {
    const task = this.startInternal();
    this.pending = task;
    void task.finally(() => { if (this.pending === task) this.pending = undefined; }).catch(() => {});
    return task;
  }
  private async startInternal(): Promise<void> {
    if (this.disposed) throw new Error("disposed");
    if (this.pending || this.cleanupTask) throw new Error("previous resources not released");
    if (!["idle", "ended", "error"].includes(this.value.phase)) throw new Error("already started");
    if (this.failedReleases.length > 0 && !(await this.retryReleases())) throw new Error("previous resources not released");
    const id = ++this.generation;
    this.muted = false;
    this.abort = new AbortController();
    try {
      this.setState("requesting-mic");
      if (!this.active(id)) return;
      const capture = await this.media.acquire16k(this.abort!.signal);
      if (!this.active(id)) {
        await this.releaseLate(() => capture.stop());
        return;
      }
      this.capture = capture;
      this.offCaptureError = capture.onError?.((error) => { if (this.active(id)) this.fail(error); });
      if (!this.active(id)) return;
      this.output = this.audio();
      if (!this.active(id)) return;
      this.setState("connecting");
      if (!this.active(id)) return;
      this.deadline = setTimeout(() => {
        if (this.active(id)) this.fail("connection timed out");
      }, 15000);
      const transport = await this.network.connect(this.abort!.signal);
      if (!this.active(id)) {
        await this.releaseLate(() => transport.close());
        return;
      }
      this.transport = transport;
      const offTransport = transport.onMessage((message) => this.receive(id, message));
      if (!this.active(id)) {
        await this.releaseLate(offTransport);
        return;
      }
      this.offTransport = offTransport;
      const offCapture = capture.onPcm16((frame) => this.input(id, frame));
      if (!this.active(id)) {
        await this.releaseLate(offCapture);
        return;
      }
      this.offCapture = offCapture;
    } catch (error) {
      if (this.active(id)) this.fail(error);
    }
  }
  private async releaseLate(release: () => Promise<void> | void): Promise<void> {
    try {
      await release();
    } catch {
      this.failedReleases.push(release);
      this.setState("error", "late resource cleanup failed");
    }
  }
  private async retryReleases(): Promise<boolean> {
    const pending = this.failedReleases.splice(0);
    for (const release of pending) await this.releaseLate(release);
    return this.failedReleases.length === 0;
  }
  setMuted(muted: boolean): void {
    if (!["ready", "muted"].includes(this.value.phase)) return;
    this.muted = muted;
    try {
      this.transport!.sendControl({ type: "mute", muted });
      this.setState(muted ? "muted" : "ready");
    } catch {
      this.fail("mute failed");
    }
  }
  private valid(frame: Uint8Array, limit: number): void {
    if (!(frame instanceof Uint8Array) || !frame.byteLength || frame.byteLength % 2 || frame.byteLength > limit)
      throw new Error("invalid PCM16 frame");
  }
  private input(id: number, frame: Uint8Array): void {
    if (!this.active(id) || this.muted || this.value.phase !== "ready") return;
    try {
      this.valid(frame, INPUT_FRAME_LIMIT);
      if (
        !Number.isFinite(this.transport!.queuedBytes) ||
        this.transport!.queuedBytes < 0 ||
        this.transport!.queuedBytes + frame.byteLength > INPUT_LIMIT
      )
        throw new Error("input queue full");
      this.transport!.send16k(frame);
    } catch (error) {
      this.fail(error);
    }
  }
  private receive(id: number, message: TransportMessage): void {
    if (!this.active(id)) return;
    try {
      switch (message.type) {
        case "ready":
          clearTimeout(this.deadline);
          this.deadline = undefined;
          this.setState(this.muted ? "muted" : "ready");
          break;
        case "interrupted":
          this.output?.clear();
          break; // Speech interruption never pauses capture or cancels work.
        case "audio":
          if (!["ready", "muted"].includes(this.value.phase)) return;
          this.valid(message.pcm16, 9600);
          if (
            !Number.isFinite(this.output!.queuedBytes) ||
            this.output!.queuedBytes < 0 ||
            this.output!.queuedBytes + message.pcm16.byteLength > OUTPUT_LIMIT
          )
            throw new Error("output buffer full");
          this.output!.enqueue24k(message.pcm16);
          break;
        case "closed":
        case "error":
          this.fail(message.reason ?? "transport disconnected");
          break;
      }
    } catch (error) {
      if (this.active(id)) this.fail(error);
    }
  }
  private fail(error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    ++this.generation;
    this.setState("error", reason);
    void this.cleanup().then((clean) => {
      if (!clean && this.value.phase === "error") this.setState("error", reason + "; resource cleanup failed");
    });
  }
  private cleanup(): Promise<boolean> {
    if (this.cleanupTask) return this.cleanupTask;
    const task = this.cleanupInternal();
    this.cleanupTask = task;
    void task.finally(() => { if (this.cleanupTask === task) this.cleanupTask = undefined; }).catch(() => {});
    return task;
  }
  private async cleanupInternal(): Promise<boolean> {
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.abort?.abort();
    this.abort = undefined;
    const capture = this.capture, output = this.output, transport = this.transport;
    const releases: Array<(() => Promise<void> | void) | undefined> = [
      this.offCapture, this.offCaptureError, this.offTransport,
      capture && (() => capture.stop()), output && (() => output.stop()), transport && (() => transport.close()),
    ];
    this.offCapture = this.offCaptureError = this.offTransport = undefined;
    this.capture = undefined;
    this.output = undefined;
    this.transport = undefined;
    for (const release of releases) if (release) await this.releaseLate(release);
    return this.failedReleases.length === 0;
  }
  async end(): Promise<void> {
    ++this.generation;
    try { this.transport?.sendControl({ type: "end" }); } catch {}
    const cleanup = this.cleanup();
    // An uncancellable getUserMedia may resolve after end; do not claim release before
    // its late capture has actually been stopped.
    const pending = this.pending;
    if (pending) await pending.catch(() => {});
    await cleanup;
    const clean = await this.retryReleases();
    this.setState(clean ? "ended" : "error", clean ? undefined : "resource cleanup failed");
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    await this.end();
  }
}
