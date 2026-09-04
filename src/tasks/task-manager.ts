import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { BoundedOutputBuffer } from "./output-buffer";

const MAX_CAPTURE_BYTES = 1_000_000;
const MAX_INSPECT_BYTES = 50_000;
const DEFAULT_KILL_GRACE_MS = 5_000;

function utf8SequenceLength(byte: number): number {
  if ((byte & 0x80) === 0) return 1;
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
  return 1;
}

function utf8SafeSlice(buffer: Buffer, limit: number): { start: number; end: number } {
  let start = 0;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;

  let end = Math.min(buffer.length, start + limit);
  if (end > start && end < buffer.length) {
    let lead = end - 1;
    while (lead > start && (buffer[lead] & 0xc0) === 0x80) lead--;
    const sequenceLength = utf8SequenceLength(buffer[lead]);
    if (lead + sequenceLength > end) {
      // Very small requested pages must still make progress without corrupting
      // one character, so they may exceed the byte limit by at most 3 bytes.
      end = lead === start && sequenceLength > limit ? Math.min(buffer.length, lead + sequenceLength) : lead;
    }
  }

  return { start, end };
}

export type TaskStatus = "running" | "completed" | "failed" | "killed";

export interface TaskLaunch {
  kind: "command" | "agent";
  command: string;
  args?: string[];
  displayCommand: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  closeStdin?: boolean;
}

export interface TaskSummary {
  id: string;
  kind: "command" | "agent";
  command: string;
  cwd: string;
  pid?: number;
  status: TaskStatus;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  signal?: string;
  baseOffset: number;
  outputEnd: number;
  timedOut: boolean;
}

interface ManagedTask extends TaskSummary {
  process: ChildProcessWithoutNullStreams;
  output: BoundedOutputBuffer;
  timeout?: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
  killRequested: boolean;
}

export interface TaskInspection extends TaskSummary {
  output: string;
  requestedOffset: number;
  nextOffset: number;
  outputLost: boolean;
  hasMore: boolean;
}

export class TaskManager {
  readonly #tasks = new Map<string, ManagedTask>();
  readonly #onComplete: (task: TaskInspection) => void;
  readonly #killGraceMs: number;
  #shuttingDown = false;

  constructor(onComplete: (task: TaskInspection) => void, killGraceMs = DEFAULT_KILL_GRACE_MS) {
    this.#onComplete = onComplete;
    this.#killGraceMs = killGraceMs;
  }

  spawn(launch: TaskLaunch): TaskSummary {
    if (this.#shuttingDown) throw new Error("Task manager is shutting down");
    const id = `task_${randomUUID().slice(0, 8)}`;
    const child = spawn(launch.command, launch.args ?? [], {
      cwd: launch.cwd,
      env: launch.env ?? process.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const task: ManagedTask = {
      id,
      kind: launch.kind,
      command: launch.displayCommand,
      cwd: launch.cwd,
      pid: child.pid,
      status: "running",
      startedAt: new Date().toISOString(),
      baseOffset: 0,
      outputEnd: 0,
      timedOut: false,
      process: child,
      output: new BoundedOutputBuffer(MAX_CAPTURE_BYTES),
      killRequested: false,
    };
    this.#tasks.set(id, task);
    if (launch.closeStdin) child.stdin.end();

    // Intentionally merge stdout and stderr for now. Stream labels and strict
    // cross-stream ordering require a structured output format; add that later.
    child.stdout.on("data", (data: Buffer) => this.#append(task, data));
    child.stderr.on("data", (data: Buffer) => this.#append(task, data));
    child.on("error", (error) => this.#append(task, `\n[spawn error] ${error.message}\n`));
    child.on("close", (code, signal) => {
      if (task.timeout) clearTimeout(task.timeout);
      if (task.killTimer) clearTimeout(task.killTimer);
      task.exitCode = code ?? undefined;
      task.signal = signal ?? undefined;
      task.completedAt = new Date().toISOString();
      task.status = task.killRequested ? "killed" : code === 0 ? "completed" : "failed";
      if (!this.#shuttingDown) this.#onComplete(this.inspect(id, Math.max(task.baseOffset, task.outputEnd - 16_000)));
    });

    if (launch.timeoutMs) {
      task.timeout = setTimeout(() => {
        task.timedOut = true;
        this.kill(id);
      }, launch.timeoutMs);
      task.timeout.unref?.();
    }

    return this.#summary(task);
  }

  list(): TaskSummary[] {
    return [...this.#tasks.values()].map((task) => this.#summary(task));
  }

  inspect(id: string, offset?: number, limit = MAX_INSPECT_BYTES): TaskInspection {
    const task = this.#require(id);
    const requestedOffset = offset ?? task.baseOffset;
    const boundedLimit = Math.max(1, Math.min(limit, MAX_INSPECT_BYTES));
    // Read a few extra bytes so a page boundary never splits a UTF-8 code point.
    const result = task.output.read(requestedOffset, boundedLimit + 3);
    const effectiveStart = result.nextOffset - result.buffer.length;
    const safe = utf8SafeSlice(result.buffer, boundedLimit);
    const nextOffset = effectiveStart + safe.end;
    return {
      ...this.#summary(task),
      output: result.buffer.subarray(safe.start, safe.end).toString("utf8"),
      requestedOffset,
      nextOffset,
      outputLost: result.outputLost || safe.start > 0,
      hasMore: nextOffset < task.outputEnd,
    };
  }

  async write(id: string, input: string, close = false): Promise<TaskSummary> {
    const task = this.#requireRunning(id);
    await new Promise<void>((resolve, reject) => {
      task.process.stdin.write(input, (error) => (error ? reject(error) : resolve()));
    });
    if (close) task.process.stdin.end();
    return this.#summary(task);
  }

  closeInput(id: string): TaskSummary {
    const task = this.#requireRunning(id);
    task.process.stdin.end();
    return this.#summary(task);
  }

  kill(id: string): TaskSummary {
    const task = this.#require(id);
    if (task.status !== "running") return this.#summary(task);
    task.killRequested = true;
    this.#signal(task, "SIGTERM");
    task.killTimer = setTimeout(() => {
      if (task.status === "running") this.#signal(task, "SIGKILL");
    }, this.#killGraceMs);
    task.killTimer.unref?.();
    return this.#summary(task);
  }

  shutdown(): void {
    this.#shuttingDown = true;
    for (const task of this.#tasks.values()) {
      if (task.timeout) clearTimeout(task.timeout);
      if (task.status === "running") this.kill(task.id);
    }
  }

  #append(task: ManagedTask, value: Buffer | string): void {
    task.output.append(value);
    task.baseOffset = task.output.baseOffset;
    task.outputEnd = task.output.endOffset;
  }

  #signal(task: ManagedTask, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && task.pid) process.kill(-task.pid, signal);
      else task.process.kill(signal);
    } catch {
      task.process.kill(signal);
    }
  }

  #require(id: string): ManagedTask {
    const task = this.#tasks.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }

  #requireRunning(id: string): ManagedTask {
    const task = this.#require(id);
    if (task.status !== "running") throw new Error(`Task ${id} is ${task.status}`);
    return task;
  }

  #summary(task: ManagedTask): TaskSummary {
    const { process: _process, output: _output, timeout: _timeout, killTimer: _killTimer, killRequested: _killRequested, ...summary } = task;
    return summary;
  }
}
