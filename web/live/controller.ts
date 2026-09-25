export type Phase = "idle" | "requesting-mic" | "connecting" | "ready" | "muted" | "ended" | "error";
export type LiveState = { phase: Phase; reason?: string };
// All PCM is binary, signed 16-bit little-endian mono. Capture: 16kHz; playback: 24kHz.
export interface Capture {
  onPcm16(cb: (frame: Uint8Array) => void): () => void;
  stop(): void;
}
export interface MediaSource {
  acquire16k(signal: AbortSignal): Promise<Capture>;
}
export interface AudioOutput {
  readonly queuedBytes: number;
  enqueue24k(frame: Uint8Array): void;
  clear(): void;
  stop(): void;
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
  close(): void;
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
  private capture?: Capture;
  private transport?: Transport;
  private output?: AudioOutput;
  private offCapture?: () => void;
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
  async start(): Promise<void> {
    if (this.disposed) throw new Error("disposed");
    if (!["idle", "ended", "error"].includes(this.value.phase)) throw new Error("already started");
    const id = ++this.generation;
    this.muted = false;
    this.abort = new AbortController();
    this.setState("requesting-mic");
    if (!this.active(id)) return;
    try {
      const capture = await this.media.acquire16k(this.abort!.signal);
      if (!this.active(id)) {
        capture.stop();
        return;
      }
      this.capture = capture;
      this.output = this.audio();
      if (!this.active(id)) return;
      this.setState("connecting");
      if (!this.active(id)) return;
      this.deadline = setTimeout(() => {
        if (this.active(id)) this.fail("connection timed out");
      }, 15000);
      const transport = await this.network.connect(this.abort!.signal);
      if (!this.active(id)) {
        transport.close();
        return;
      }
      this.transport = transport;
      const offTransport = transport.onMessage((message) => this.receive(id, message));
      if (!this.active(id)) {
        offTransport();
        return;
      }
      this.offTransport = offTransport;
      const offCapture = capture.onPcm16((frame) => this.input(id, frame));
      if (!this.active(id)) {
        offCapture();
        return;
      }
      this.offCapture = offCapture;
    } catch (error) {
      if (this.active(id)) this.fail(error);
    }
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
    const clean = this.cleanup();
    this.setState("error", reason + (clean ? "" : "; resource cleanup failed"));
  }
  private cleanup(): boolean {
    let clean = true;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.abort?.abort();
    this.abort = undefined;
    const capture = this.capture,
      output = this.output,
      transport = this.transport;
    const releases = [
      this.offCapture,
      this.offTransport,
      () => capture?.stop(),
      () => output?.stop(),
      () => transport?.close(),
    ];
    this.offCapture = this.offTransport = undefined;
    this.capture = undefined;
    this.output = undefined;
    this.transport = undefined;
    // Snapshot resources before clearing ownership (above).
    for (const release of releases) {
      try {
        release?.();
      } catch {
        clean = false; // Continue releasing remaining resources, but do not claim success.
      }
    }
    return clean;
  }
  end(): void {
    if (this.disposed || this.value.phase === "ended") return;
    ++this.generation;
    try {
      this.transport?.sendControl({ type: "end" });
    } catch {}
    const clean = this.cleanup();
    this.setState(clean ? "ended" : "error", clean ? undefined : "resource cleanup failed");
  }
  dispose(): void {
    if (this.disposed) return;
    this.end();
    this.disposed = true;
    this.listeners.clear();
  }
}
