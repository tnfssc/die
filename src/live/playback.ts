/** Bounded real-time PCM16/24kHz mono playback. Pipe writes are not audible acknowledgements. */
export const FRAME_BYTES = 960; // 20ms
export const MAX_PENDING_BYTES = 2_880_000; // 60 seconds
export type PlaybackClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};
export type PlaybackState = { pendingBytes: number; nativeQueuedMs: number; inFlight: boolean; epoch: number };
export type PlaybackOptions = {
  send(frame: Buffer, generation: number): Promise<void>;
  flush(generation: number): Promise<void>;
  onError(error: Error): void;
  onState?: (state: PlaybackState) => void;
  clock?: PlaybackClock;
  maxPendingBytes?: number;
};
type Piece = { data: Buffer; offset: number } | null; // null is a turn boundary
const realClock: PlaybackClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};
export class PlaybackScheduler {
  private readonly clock: PlaybackClock;
  private readonly limit: number;
  private pieces: Piece[] = [];
  private pending = 0;
  private epochValue = 0;
  private active = false;
  private closed = false;
  private blocked = false;
  private overflowed = false;
  private writing = false;
  private flushing = false;
  private timer?: ReturnType<typeof setTimeout>;
  private ringMs = 0;
  private ringAt = 0;
  constructor(private readonly options: PlaybackOptions) {
    this.clock = options.clock ?? realClock;
    this.limit = options.maxPendingBytes ?? MAX_PENDING_BYTES;
    if (!Number.isSafeInteger(this.limit) || this.limit < FRAME_BYTES)
      throw new Error("Invalid playback pending limit");
  }
  get state(): PlaybackState {
    return {
      pendingBytes: this.pending,
      nativeQueuedMs: this.remainingRing(),
      inFlight: this.writing,
      epoch: this.epochValue,
    };
  }
  private emit() {
    this.options.onState?.(this.state);
  }
  /** Call only when native is ready. Idempotent. */
  start() {
    if (this.closed || this.active) return;
    this.active = true;
    if (this.epochValue) this.flushNative();
    else this.pump();
  }
  /** Copies PCM input. Returns false on stale generation, invalid input or capacity failure. */
  enqueue(data: Buffer, epoch: number): boolean {
    if (this.closed || this.blocked || epoch !== this.epochValue || this.overflowed) return false;
    if (!Buffer.isBuffer(data) || data.length % 2) {
      this.options.onError(new Error("Invalid PCM16 playback chunk"));
      return false;
    }
    if (!data.length) return true;
    if (data.length > this.limit - this.pending) {
      this.overflowed = true;
      this.options.onError(
        new Error("Playback response exceeds pending budget (" + this.limit + " bytes); audio incomplete"),
      );
      return false;
    }
    this.pieces.push({ data: Buffer.from(data), offset: 0 });
    this.pending += data.length;
    this.emit();
    this.pump();
    return true;
  }
  /** Allows a sub-frame tail through; never flushes at a normal turn boundary. */
  turnComplete(epoch: number) {
    if (this.closed || epoch !== this.epochValue) return;
    if (this.pieces.length && this.pieces.at(-1) !== null) this.pieces.push(null);
    this.pump();
  }
  /** Native played events report ring depth, not a per-frame audible acknowledgement. */
  nativeQueued(ms: number) {
    if (this.closed || !Number.isFinite(ms) || ms < 0) return;
    // Reports have no write/epoch acknowledgement: a delayed low report must
    // not erase credit already reserved for writes sent since its snapshot.
    this.ringMs = Math.max(this.remainingRing(), ms);
    this.ringAt = this.clock.now();
    this.emit();
    this.pump();
  }
  /** Discard unsent prior-epoch bytes now; native flush precedes any new sends. */
  interrupt(epoch: number) {
    if (this.closed || !Number.isSafeInteger(epoch) || epoch <= this.epochValue) return;
    this.cancelTimer();
    this.epochValue = epoch;
    this.pieces = [];
    this.pending = 0;
    this.overflowed = false;
    this.blocked = false;
    this.ringMs = 0;
    this.ringAt = this.clock.now();
    this.emit();
    if (this.active) this.flushNative();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.active = false;
    this.cancelTimer();
    this.pieces = [];
    this.pending = 0;
    this.emit();
  }
  private remainingRing() {
    return Math.max(0, this.ringMs - Math.max(0, this.clock.now() - this.ringAt));
  }
  private cancelTimer() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
  private flushNative() {
    const epoch = this.epochValue;
    this.flushing = true;
    // Invoke immediately even if an old pipe write has not settled.
    let result: Promise<void>;
    try {
      result = this.options.flush(epoch);
    } catch (cause) {
      result = Promise.reject(cause);
    }
    Promise.resolve(result).then(
      () => {
        if (this.closed || epoch !== this.epochValue) return;
        this.flushing = false;
        this.pump();
      },
      (cause) => {
        if (this.closed || epoch !== this.epochValue) return;
        this.flushing = false;
        this.blocked = true;
        this.options.onError(new Error("Playback flush failed"));
      },
    );
  }
  private available(): { bytes: number; boundary: boolean } {
    let bytes = 0;
    for (const part of this.pieces) {
      if (part === null) return { bytes, boundary: true };
      bytes += part.data.length - part.offset;
      if (bytes >= FRAME_BYTES) break;
    }
    return { bytes, boundary: false };
  }
  private take(count: number): Buffer {
    const frame = Buffer.allocUnsafe(count);
    let offset = 0;
    while (offset < count) {
      const part = this.pieces[0];
      if (!part) throw new Error("Playback frame crossed turn boundary");
      const size = Math.min(count - offset, part.data.length - part.offset);
      part.data.copy(frame, offset, part.offset, part.offset + size);
      part.offset += size;
      offset += size;
      if (part.offset === part.data.length) this.pieces.shift();
    }
    this.pending -= count;
    if (this.pieces[0] === null) this.pieces.shift();
    return frame;
  }
  private pump() {
    if (!this.active || this.closed || this.flushing || this.blocked || this.writing) return;
    while (this.pieces[0] === null) this.pieces.shift();
    const { bytes, boundary } = this.available();
    if (bytes < FRAME_BYTES && !boundary) return;
    if (!bytes) return;
    const now = this.clock.now();
    // Refill a small reserve, not one frame per timer. Late timers can recover
    // without accumulating unlimited catch-up credit: at most 80ms is reserved.
    const wait = Math.max(0, this.remainingRing() - 60);
    if (wait > 0) {
      this.cancelTimer();
      this.timer = this.clock.setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      return;
    }
    this.cancelTimer();
    const frame = this.take(Math.min(FRAME_BYTES, bytes));
    const epoch = this.epochValue;
    this.ringMs = this.remainingRing() + frame.length / 48;
    this.ringAt = now;
    this.writing = true;
    this.emit();
    let result: Promise<void>;
    try {
      result = this.options.send(frame, epoch);
    } catch (cause) {
      result = Promise.reject(cause);
    }
    Promise.resolve(result).then(
      () => {
        this.writing = false;
        if (this.closed) return;
        this.emit();
        this.pump();
      },
      (cause) => {
        this.writing = false;
        if (this.closed) return;
        if (epoch !== this.epochValue) {
          this.pump();
          return;
        } // cancellation is expected
        this.blocked = true;
        this.options.onError(new Error("Playback write failed"));
      },
    );
  }
}
