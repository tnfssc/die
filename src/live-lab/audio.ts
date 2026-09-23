/** Process boundary for the experimental macOS voice-only helper (protocol v1). */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

type Worker = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr" | "on" | "kill">;
export type AudioDiagnostics = { queuedMs: number; captureFrames: number; capturedBytes: number };
export type AudioCallbacks = { capture?: (pcm16: Buffer) => void; played?: (queuedMs: number) => void; error?: (code: string, message: string) => void };
export type AudioOptions = {
  /** Only trusted developer paths; never downloaded or discovered on PATH. */
  helperPath?: string;
  /** Test-only process injection; bypasses platform/device checks. */
  worker?: Worker;
  callbacks?: AudioCallbacks;
  helloTimeoutMs?: number;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
};
const MAX_LINE = 64 * 1024;
const MAX_CAPTURE = 640; // 20ms PCM16 mono 16k
const MAX_PLAY = 48_000; // at most one second PCM16 mono 24k per message
const MAX_PENDING = 256 * 1024;
const MAX_STDERR = 4096;
const DEFAULT_HELPER = resolve("dist/live-lab-helper");
const safeCode = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(value) ? value : "helper_error";
const safeMessage = (_value: unknown) => "Audio helper reported an error"; // never forward untrusted helper text/logs
function decode(data: unknown, max: number): Buffer {
  if (typeof data !== "string" || data.length === 0 || data.length > Math.ceil(max / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error("Invalid audio frame");
  const result = Buffer.from(data, "base64");
  if (result.length === 0 || result.length > max || result.length % 2 !== 0 || result.toString("base64") !== data) throw new Error("Invalid audio frame");
  return result;
}
function generation(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid audio generation");
}
export class LiveLabAudio {
  private state: "hello" | "idle" | "starting" | "running" | "stopping" | "closed" = "hello";
  private line = "";
  private pendingBytes = 0;
  private queue: { payload: string; bytes: number; resolve: () => void; reject: (error: Error) => void }[] = [];
  private writing = false;
  private waiting: { kind: "hello" | "ready" | "stopped"; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  private stderrBytes = 0;
  private currentGeneration = 0;
  readonly diagnostics: AudioDiagnostics = { queuedMs: 0, captureFrames: 0, capturedBytes: 0 };
  private constructor(private readonly worker: Worker, private readonly options: AudioOptions) {
    worker.stdout.on("data", (chunk: Buffer) => this.read(chunk));
    worker.stderr.on("data", (chunk: Buffer) => { this.stderrBytes = Math.min(MAX_STDERR, this.stderrBytes + chunk.length); }); // discard logs, including audio/key-like material
    worker.on("error", () => this.fail(new Error("Audio helper process failed")));
    worker.on("exit", () => this.fail(new Error("Audio helper exited")));
    worker.stdin.on("error", () => this.fail(new Error("Audio helper input failed")));
  }
  static async launch(options: AudioOptions = {}): Promise<LiveLabAudio> {
    let worker = options.worker;
    if (!worker) {
      if (process.platform !== "darwin") throw new Error("Audio helper requires macOS");
      if (!process.stdin.isTTY || process.env.SSH_CONNECTION || process.env.SSH_TTY) throw new Error("Audio helper requires a local interactive terminal");
      const path = resolve(options.helperPath ?? DEFAULT_HELPER);
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile() || !(info.mode & 0o111)) throw new Error("Audio helper is missing or not executable; build the local helper first");
      worker = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
    }
    const audio = new LiveLabAudio(worker, options);
    try { await audio.waitFor("hello", options.helloTimeoutMs ?? 3000); return audio; }
    catch (error) { audio.close(); throw error; }
  }
  private waitFor(kind: "hello" | "ready" | "stopped", ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return Promise.reject(new Error("Invalid audio timeout"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Audio helper ${kind} timed out`)), ms);
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
      // Byte limit before UTF-8 conversion prevents a single huge chunk from bypassing the line cap.
      for (const byte of chunk) {
        if (byte === 10) {
          const raw = this.line; this.line = "";
          if (raw.endsWith("\r")) this.handle(raw.slice(0, -1)); else this.handle(raw);
        } else {
          this.line += String.fromCharCode(byte);
          if (this.line.length > MAX_LINE) throw new Error("Audio helper line too large");
        }
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
    if (m.type === "error") { this.options.callbacks?.error?.(safeCode(m.code), safeMessage(m.message)); this.fail(new Error("Audio helper reported an error")); return; }
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
  async start(): Promise<void> {
    if (this.state !== "idle") throw new Error("Audio helper not idle");
    this.state = "starting";
    const ready = this.waitFor("ready", this.options.startTimeoutMs ?? 5000);
    void this.send({ type: "start" }).catch(() => this.fail(new Error("Audio helper input failed")));
    return ready;
  }
  play(pcm16: Buffer, gen: number): Promise<void> {
    if (this.state !== "running") return Promise.reject(new Error("Audio helper not running"));
    generation(gen);
    if (gen !== this.currentGeneration) return Promise.reject(new Error("Stale audio generation; flush before changing generation"));
    if (!Buffer.isBuffer(pcm16) || !pcm16.length || pcm16.length > MAX_PLAY || pcm16.length % 2) return Promise.reject(new Error("Invalid playback frame"));
    this.currentGeneration = gen;
    return this.send({ type: "play", data: pcm16.toString("base64"), generation: gen });
  }
  flush(gen: number): Promise<void> {
    if (this.state !== "running") return Promise.reject(new Error("Audio helper not running"));
    generation(gen);
    if (gen <= this.currentGeneration) return Promise.reject(new Error("Flush generation must increase"));
    this.currentGeneration = gen;
    return this.send({ type: "flush", generation: gen });
  }
  private send(msg: object): Promise<void> {
    if (this.state === "closed") return Promise.reject(new Error("Audio helper closed"));
    const payload = JSON.stringify(msg) + "\n";
    const bytes = Buffer.byteLength(payload);
    if (this.pendingBytes + bytes > MAX_PENDING) return Promise.reject(new Error("Audio helper input queue full"));
    return new Promise((resolve, reject) => {
      this.pendingBytes += bytes; this.queue.push({ payload, bytes, resolve, reject }); this.pump();
    });
  }
  private pump() {
    if (this.writing || this.state === "closed") return;
    const item = this.queue[0]; if (!item) return;
    this.writing = true;
    let callbackDone = false; let drained = false;
    const finish = () => {
      if (!callbackDone || !drained || this.state === "closed") return;
      this.queue.shift(); this.pendingBytes -= item.bytes; this.writing = false; item.resolve(); this.pump();
    };
    try {
      drained = this.worker.stdin.write(item.payload, (err?: Error | null) => {
        if (err) { this.fail(new Error("Audio helper input failed")); return; }
        callbackDone = true; finish();
      });
      if (!drained) this.worker.stdin.once("drain", () => { drained = true; finish(); });
      finish();
    } catch { this.fail(new Error("Audio helper input failed")); }
  }
  async stop(): Promise<void> {
    if (this.state === "closed") return;
    if (this.state === "hello" || this.state === "starting") { this.close(); return; }
    if (this.state === "stopping") return;
    this.state = "stopping";
    const stopped = this.waitFor("stopped", this.options.stopTimeoutMs ?? 2000);
    void this.send({ type: "stop" }).catch(() => this.close());
    try { await stopped; } catch { this.close(); }
  }
  close() { this.fail(new Error("Audio helper closed")); }
  private fail(error: Error) {
    if (this.state === "closed") return;
    this.state = "closed"; this.line = "";
    if (this.waiting) { clearTimeout(this.waiting.timer); this.waiting.reject(error); this.waiting = undefined; }
    for (const item of this.queue) item.reject(error);
    this.queue = []; this.pendingBytes = 0;
    this.worker.kill();
  }
}
