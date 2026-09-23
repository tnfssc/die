/** Process boundary for the experimental macOS voice-only helper (protocol v1). */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Worker = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr" | "on" | "off" | "kill">;
export type AudioDiagnostics = { queuedMs: number; captureFrames: number; capturedBytes: number };
/** Error is terminal (static code/message), closed fires exactly once on either failure or normal shutdown.
 * Observers must not throw; observer exceptions are isolated. */
export type AudioCallbacks = { capture?: (pcm16: Buffer) => void; played?: (queuedMs: number) => void; error?: (code: string, message: string) => void; closed?: () => void };
export type AudioOptions = {
  /** Only trusted developer paths; never downloaded or discovered on PATH. */
  helperPath?: string;
  /** Test-only process injection; bypasses platform/device checks. Owned after launch begins. */
  worker?: Worker;
  callbacks?: AudioCallbacks;
  helloTimeoutMs?: number;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  /** Aborts launch (including before stat/spawn) and start. Does not abort after ready. */
  signal?: AbortSignal;
};
const MAX_LINE = 64 * 1024;
const MAX_CAPTURE = 640; // 20ms PCM16 mono 16k
const MAX_PLAY = 9_600; // at most 200ms PCM16 mono 24k per message
const MAX_PENDING = 64 * 1024; // ~1.3 seconds of encoded PCM at 24k
const MAX_STDERR = 4096;
const DEFAULT_HELPER = fileURLToPath(new URL("../../dist/live-lab-audio", import.meta.url));
const safeCode = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(value) ? value : "helper_error";
const safeMessage = (_value: unknown) => "Audio helper reported an error"; // never forward untrusted helper text/logs
function decode(data: unknown, max: number): Buffer {
  if (typeof data !== "string" || data.length === 0 || data.length > Math.ceil(max / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error("Invalid audio frame");
  const result = Buffer.from(data, "base64");
  if (result.length === 0 || result.length > max || result.length % 2 !== 0 || result.toString("base64") !== data) throw new Error("Invalid audio frame");
  return result;
}
function generation(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new Error("Invalid audio generation");
}
export class LiveLabAudio {
  private state: "hello" | "idle" | "starting" | "running" | "stopping" | "closed" = "hello";
  private line = Buffer.alloc(0);
  private pendingBytes = 0;
  private queue: { payload: string; bytes: number; type: string; resolve: () => void; reject: (error: Error) => void }[] = [];
  private drainListener?: () => void;
  private reapTimer?: ReturnType<typeof setTimeout>;
  private stoppedPromise?: Promise<void>;
  private writing = false;
  private waiting: { kind: "hello" | "ready" | "stopped"; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  private stderrBytes = 0;
  private currentGeneration = 0;
  readonly diagnostics: AudioDiagnostics = { queuedMs: 0, captureFrames: 0, capturedBytes: 0 };
  private readonly onData = (chunk: Buffer) => this.read(chunk);
  private readonly onStderr = (chunk: Buffer) => { this.stderrBytes = Math.min(MAX_STDERR, this.stderrBytes + chunk.length); };
  private readonly onError = () => this.fail(new Error("Audio helper process failed"));
  private readonly onExit = () => this.fail(new Error("Audio helper exited"));
  private readonly onInputError = () => this.fail(new Error("Audio helper input failed"));
  private readonly onReaped = () => {
    if (this.state !== "closed") this.fail(new Error("Audio helper exited"));
    if (this.reapTimer) clearTimeout(this.reapTimer);
    this.reapTimer = undefined;
    this.worker.off("error", this.onError);
    this.worker.stdin.off("error", this.onInputError);
    this.worker.off("close", this.onReaped);
  };
  private constructor(private readonly worker: Worker, private readonly options: AudioOptions) {
    worker.stdout.on("data", this.onData);
    worker.stderr.on("data", this.onStderr);
    worker.on("error", this.onError);
    worker.on("exit", this.onExit);
    worker.stdin.on("error", this.onInputError);
    worker.on("close", this.onReaped);
  }
  /** Launches without opening a device; waits for protocol-v1 hello. Caller must start() explicitly. */
  static async launch(options: AudioOptions = {}): Promise<LiveLabAudio> {
    const aborted = () => { if (options.signal?.aborted) throw new Error("Audio helper launch cancelled"); };
    aborted();
    let worker = options.worker;
    if (!worker) {
      if (process.platform !== "darwin") throw new Error("Audio helper requires macOS");
      if (!process.stdin.isTTY || process.env.SSH_CONNECTION || process.env.SSH_TTY) throw new Error("Audio helper requires a local interactive terminal");
      const path = resolve(options.helperPath ?? DEFAULT_HELPER);
      const info = await stat(path).catch(() => undefined);
      aborted();
      if (!info?.isFile() || !(info.mode & 0o111)) throw new Error("Audio helper is missing or not executable; build the local helper first");
      worker = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
    }
    const audio = new LiveLabAudio(worker, options);
    try { await audio.withAbort(audio.waitFor("hello", options.helloTimeoutMs ?? 3000), "launch"); return audio; }
    catch (error) { audio.close(); throw error; }
  }
  private async withAbort<T>(promise: Promise<T>, phase: string): Promise<T> {
    const signal = this.options.signal;
    if (!signal) return promise;
    if (signal.aborted) { void promise.catch(() => {}); this.close(); throw new Error("Audio helper " + phase + " cancelled"); }
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => { reject(new Error("Audio helper " + phase + " cancelled")); this.close(); };
      signal.addEventListener("abort", abort, { once: true });
    });
    try { return await Promise.race([promise, cancelled]); }
    finally { signal.removeEventListener("abort", abort); }
  }
  private waitFor(kind: "hello" | "ready" | "stopped", ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0 || ms > 60_000) {
      const error = new Error("Invalid audio timeout"); this.fail(error); return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => kind === "stopped" ? this.close() : this.fail(new Error(`Audio helper ${kind} timed out`)), ms);
      this.waiting = { kind, resolve, reject, timer };
    });
  }
  private signal(kind: "hello" | "ready" | "stopped") {
    if (this.waiting?.kind !== kind) throw new Error("Unexpected audio helper response");
    const wait = this.waiting; this.waiting = undefined; clearTimeout(wait.timer); wait.resolve();
  }
  private read(chunk: Buffer) {
    if (this.state === "closed") return;
    try {
      if (!Buffer.isBuffer(chunk) || chunk.length > MAX_LINE * 4) throw new Error("Oversized chunk");
      let start = 0;
      while (start < chunk.length && this.state !== "closed") {
        const end = chunk.indexOf(10, start);
        const part = chunk.subarray(start, end < 0 ? undefined : end);
        if (this.line.length + part.length > MAX_LINE) throw new Error("Oversized line");
        this.line = Buffer.concat([this.line, part]);
        if (end < 0) break;
        const raw = this.line; this.line = Buffer.alloc(0);
        this.handle(raw.subarray(0, raw.at(-1) === 13 ? -1 : undefined).toString("utf8"));
        start = end + 1;
      }
    } catch { this.fail(new Error("Invalid audio helper protocol")); }
  }
  private handle(line: string) {
    const msg: unknown = JSON.parse(Buffer.from(line, "latin1").toString("utf8"));
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) throw new Error("Invalid message");
    const m = msg as Record<string, unknown>;
    if (this.state === "hello") {
      if (m.type !== "hello" || m.protocol !== 1) throw new Error("Incompatible helper");
      this.state = "idle"; this.signal("hello"); return;
    }
    if (m.type === "ready" && this.state === "starting") { this.state = "running"; this.signal("ready"); return; }
    if (m.type === "stopped" && this.state === "stopping") { this.signal("stopped"); this.close(); return; }
    if (m.type === "error") { this.fail(new Error("Audio helper reported an error"), safeCode(m.code)); return; }
    if (this.state !== "running") throw new Error("Unexpected audio helper event");
    if (m.type === "capture") {
      const pcm = decode(m.data, MAX_CAPTURE);
      if (pcm.length !== MAX_CAPTURE) throw new Error("Invalid capture duration");
      this.diagnostics.captureFrames++; this.diagnostics.capturedBytes += pcm.length;
      this.options.callbacks?.capture?.(pcm); return;
    }
    if (m.type === "played" && typeof m.queuedMs === "number" && Number.isFinite(m.queuedMs) && m.queuedMs >= 0 && m.queuedMs <= 60_000) {
      this.diagnostics.queuedMs = m.queuedMs; this.options.callbacks?.played?.(m.queuedMs); return;
    }
    throw new Error("Unexpected audio helper event");
  }
  /** Opens the default audio device only after explicit start; resolves on ready. */
  async start(): Promise<void> {
    if (this.state !== "idle") throw new Error("Audio helper not idle");
    this.state = "starting";
    const ready = this.waitFor("ready", this.options.startTimeoutMs ?? 5000);
    void this.send({ type: "start" }).catch(() => this.fail(new Error("Audio helper input failed")));
    return this.withAbort(ready, "start");
  }
  /** 24kHz mono little-endian PCM16, at most 200ms. Resolves when stdin accepts the write, NOT when played. */
  play(pcm16: Buffer, gen: number): Promise<void> {
    if (this.state !== "running") return Promise.reject(new Error("Audio helper not running"));
    generation(gen);
    if (gen !== this.currentGeneration) return Promise.reject(new Error("Stale audio generation; flush before changing generation"));
    if (!Buffer.isBuffer(pcm16) || !pcm16.length || pcm16.length > MAX_PLAY || pcm16.length % 2) return Promise.reject(new Error("Invalid playback frame"));
    this.currentGeneration = gen;
    return this.send({ type: "play", data: pcm16.toString("base64"), generation: gen });
  }
  /** Interrupt with a strictly increasing int32 generation. Drops unsent play writes (their promises reject).
   * A pending write may already have entered the pipe; neither flush nor close can retract it. */
  flush(gen: number): Promise<void> {
    if (this.state !== "running") return Promise.reject(new Error("Audio helper not running"));
    generation(gen);
    if (gen <= this.currentGeneration) return Promise.reject(new Error("Flush generation must increase"));
    this.currentGeneration = gen;
    this.dropQueuedPlay();
    return this.send({ type: "flush", generation: gen });
  }
  private dropQueuedPlay() {
    this.queue = this.queue.filter((item, index) => {
      if (item.type !== "play" || (index === 0 && this.writing)) return true;
      this.pendingBytes -= item.bytes; item.reject(new Error("Audio playback interrupted")); return false;
    });
  }
  private send(msg: { type: string; [key: string]: unknown }): Promise<void> {
    if (this.state === "closed") return Promise.reject(new Error("Audio helper closed"));
    const payload = JSON.stringify(msg) + "\n";
    const bytes = Buffer.byteLength(payload);
    if (this.pendingBytes + bytes > MAX_PENDING - (msg.type === "play" ? 256 : 0)) return Promise.reject(new Error("Audio helper input queue full"));
    return new Promise((resolve, reject) => {
      this.pendingBytes += bytes; this.queue.push({ payload, bytes, type: msg.type, resolve, reject }); this.pump();
    });
  }
  private pump() {
    if (this.writing || this.state === "closed") return;
    const item = this.queue[0]; if (!item) return;
    this.writing = true;
    let callbackDone = false; let drained = false;
    const finish = () => {
      if (!callbackDone || !drained || this.state === "closed") return;
      if (this.drainListener) { this.worker.stdin.off("drain", this.drainListener); this.drainListener = undefined; }
      this.queue.shift(); this.pendingBytes -= item.bytes; this.writing = false; item.resolve(); this.pump();
    };
    try {
      drained = this.worker.stdin.write(item.payload, (err?: Error | null) => {
        if (err) { this.fail(new Error("Audio helper input failed")); return; }
        callbackDone = true; finish();
      });
      if (!drained && this.state !== "closed") {
        this.drainListener = () => { drained = true; this.drainListener = undefined; finish(); };
        this.worker.stdin.once("drain", this.drainListener);
      }
      finish();
    } catch { this.fail(new Error("Audio helper input failed")); }
  }
  /** Normal stop resolves after stopped; timeout closes the helper without reporting failure. */
  stop(): Promise<void> {
    if (this.stoppedPromise) return this.stoppedPromise;
    if (this.state === "closed") return Promise.resolve();
    if (this.state === "hello" || this.state === "starting" || this.state === "idle") { this.close(); return Promise.resolve(); }
    this.state = "stopping";
    this.dropQueuedPlay();
    const stopped = this.waitFor("stopped", this.options.stopTimeoutMs ?? 2000);
    void this.send({ type: "stop" }).catch(() => this.close());
    this.stoppedPromise = stopped.catch(() => { this.close(); });
    return this.stoppedPromise;
  }
  /** End ownership; no error callback. Already-written audio cannot be retracted. */
  close() { this.shutdown(); }
  private fail(error: Error, code = "helper_failure") { this.shutdown(error, code); }
  private shutdown(error?: Error, code = "helper_failure") {
    if (this.state === "closed") return;
    this.state = "closed"; this.line = Buffer.alloc(0);
    this.worker.stdout.off("data", this.onData);
    this.worker.stderr.off("data", this.onStderr);
    this.worker.off("exit", this.onExit);
    if (this.drainListener) { this.worker.stdin.off("drain", this.drainListener); this.drainListener = undefined; }
    const reason = error ?? new Error("Audio helper closed");
    if (this.waiting) { clearTimeout(this.waiting.timer); this.waiting.reject(reason); this.waiting = undefined; }
    for (const item of this.queue) item.reject(reason);
    this.queue = []; this.pendingBytes = 0; this.writing = false;
    // Retain error guards until child close or bounded reaping: kill can emit late errors.
    try { this.worker.kill("SIGTERM"); } catch { /* exited */ }
    this.reapTimer = setTimeout(() => {
      try { this.worker.kill("SIGKILL"); } catch { /* exited */ }
      this.onReaped();
    }, 1000);
    this.reapTimer.unref?.();
    if (error) { try { this.options.callbacks?.error?.(code, safeMessage(undefined)); } catch { /* observer */ } }
    try { this.options.callbacks?.closed?.(); } catch { /* observer */ }
  }
}
