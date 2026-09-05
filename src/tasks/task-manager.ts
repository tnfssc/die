import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { BoundedOutputBuffer } from "./output-buffer";
import { getJobResponseDeliverySignal, JOB_RESPONSE_ACK_EVENT, supportsJobResponseAcknowledgement } from "../typescript/job-bridge";

import { AgentProgress, type AgentInfo } from "./agent-progress";

const MAX_CAPTURE_BYTES = 1_000_000;
const MAX_INSPECT_BYTES = 5_000;
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
  id?: string;
  agent?: AgentInfo;
  kind: "command" | "agent";
  command: string;
  args?: string[];
  displayCommand: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  closeStdin?: boolean;
  notifyOnComplete?: boolean;
}

export interface TaskSummary {
  agent?: AgentInfo;
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
  completionOutput?: string;
  process?: ChildProcessWithoutNullStreams;
  output: BoundedOutputBuffer;
  timeout?: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
  killRequested: boolean;
  notifyOnComplete: boolean;
  completion?: Promise<TaskInspection>;
  resolveCompletion?: (task: TaskInspection) => void;
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
  #shutdown?: Promise<void>;
  readonly #listeners = new Set<() => void>();

  constructor(onComplete: (task: TaskInspection) => void, killGraceMs = DEFAULT_KILL_GRACE_MS) {
    this.#onComplete = onComplete;
    this.#killGraceMs = killGraceMs;
  }

  /** Observe registry/output changes without taking ownership of completion delivery. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  spawn(launch: TaskLaunch): TaskSummary {
    if (this.#shuttingDown) throw new Error("Task manager is shutting down");
    const id = launch.id ?? `task_${randomUUID().slice(0, 8)}`;
    if (this.#tasks.has(id)) throw new Error("Duplicate task ID");
    const child = spawn(launch.command, launch.args ?? [], {
      cwd: launch.cwd,
      env: launch.env ?? process.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let resolveCompletion!: (task: TaskInspection) => void;
    const completion = new Promise<TaskInspection>((resolve) => {
      resolveCompletion = resolve;
    });
    const task: ManagedTask = {
      id,
      agent: launch.agent ? { ...launch.agent, phase: "starting", events: 0 } : undefined,
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
      notifyOnComplete: launch.notifyOnComplete ?? true,
      completion,
      resolveCompletion,
    };
    this.#tasks.set(id, task);
    this.#changed();
    if (launch.closeStdin) child.stdin.end();

    // Intentionally merge stdout and stderr for now. Stream labels and strict
    // cross-stream ordering require a structured output format; add that later.
    const progress = task.agent ? new AgentProgress(task.agent, value => this.#append(task, value)) : undefined;
    child.stdout.on("data", (data: Buffer) => progress ? progress.push(data) : this.#append(task, data));
    child.stderr.on("data", (data: Buffer) => {
      if (task.agent) {
        task.agent.lastActivityAt = new Date().toISOString();
        task.agent.lastError = data.toString("utf8").slice(-2000);
      }
      this.#append(task, data);
    });
    child.on("error", (error) => this.#append(task, `\n[spawn error] ${error.message}\n`));
    child.on("exit", () => {
      // A shell can exit on SIGTERM while descendants ignore it, even after
      // closing their output pipes. Do not let close cancel escalation and
      // strand the remaining process-group members.
      if (task.killRequested) this.#signal(task, "SIGKILL");
    });
    child.on("close", (code, signal) => {
      progress?.finish();
      if (task.timeout) clearTimeout(task.timeout);
      if (task.killTimer) clearTimeout(task.killTimer);
      task.timeout = undefined;
      task.killTimer = undefined;
      task.exitCode = code ?? undefined;
      task.signal = signal ?? undefined;
      task.completedAt = new Date().toISOString();
      task.status = task.killRequested ? "killed" : code === 0 && !progress?.failed ? "completed" : "failed";
      this.#changed();
      if (task.agent) task.agent.phase = task.status;
      const inspection = this.inspect(id, Math.max(task.baseOffset, task.outputEnd - MAX_INSPECT_BYTES));
      // Notifications carry the answer, while inspect retains the activity log.
      if (progress && task.status === "completed" && progress.final.retainedBytes) {
        const answer = progress.final.read(progress.final.baseOffset, MAX_INSPECT_BYTES).buffer;
        const safe = utf8SafeSlice(answer, MAX_INSPECT_BYTES);
        inspection.output = answer.subarray(safe.start, safe.end).toString("utf8");
        task.completionOutput = inspection.output;
      }
      const resolveTask = task.resolveCompletion;
      task.process = undefined;
      task.completion = undefined;
      task.resolveCompletion = undefined;
      resolveTask?.(inspection);
      if (!this.#shuttingDown && task.notifyOnComplete) this.#notify(inspection);
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

  wait(id: string): Promise<TaskInspection> {
    const task = this.#require(id);
    if (task.status !== "running") {
      const inspection = this.inspect(id, Math.max(task.baseOffset, task.outputEnd - MAX_INSPECT_BYTES));
      if (task.completionOutput !== undefined) inspection.output = task.completionOutput;
      return Promise.resolve(inspection);
    }
    return task.completion!;
  }

  /** Hand off notification ownership exactly once when a foreground wait expires. */
  async foreground(id: string, waitMs: number, signal?: AbortSignal): Promise<TaskInspection & { background: boolean }> {
    const task = this.#require(id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      if (waitMs > 0 && !signal?.aborted) {
        await Promise.race([
          this.wait(id),
          new Promise<void>(resolve => { timer = setTimeout(resolve, waitMs); }),
          new Promise<void>(resolve => {
            onAbort = resolve;
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) resolve();
          }),
        ]);
      }
      if (task.status !== "running" && !signal?.aborted) {
        const result = { ...await this.wait(id), background: false };
        // Bridge responses are only owned by the foreground caller once the
        // worker acknowledges receipt. A disconnect before that point returns
        // ownership to session notification delivery.
        const deliverySignal = getJobResponseDeliverySignal(signal);
        if (deliverySignal && supportsJobResponseAcknowledgement(deliverySignal)) {
          let settled = false;
          const cleanup = () => {
            deliverySignal.removeEventListener(JOB_RESPONSE_ACK_EVENT, acknowledged);
            deliverySignal.removeEventListener("abort", disconnected);
          };
          const acknowledged = () => { if (!settled) { settled = true; cleanup(); } };
          const disconnected = () => {
            if (settled) return;
            settled = true;
            cleanup();
            if (!task.notifyOnComplete) {
              task.notifyOnComplete = true;
              if (!this.#shuttingDown) this.#notify(result);
            }
          };
          deliverySignal.addEventListener(JOB_RESPONSE_ACK_EVENT, acknowledged, { once: true });
          deliverySignal.addEventListener("abort", disconnected, { once: true });
          if (deliverySignal.aborted) disconnected();
        }
        return result;
      }
      if (!task.notifyOnComplete) {
        task.notifyOnComplete = true;
        // A disconnect may race completion, before its result reached the worker.
        if (task.status !== "running" && !this.#shuttingDown) this.#notify(await this.wait(id));
      }
      return { ...this.inspect(id), background: true };
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }

  async write(id: string, input: string, close = false): Promise<TaskSummary> {
    const task = this.#requireRunning(id);
    const stdin = task.process!.stdin;
    await new Promise<void>((resolve, reject) => {
      stdin.write(input, (error) => (error ? reject(error) : resolve()));
    });
    if (close && !stdin.destroyed) stdin.end();
    return this.#summary(task);
  }

  closeInput(id: string): TaskSummary {
    const task = this.#requireRunning(id);
    task.process!.stdin.end();
    return this.#summary(task);
  }

  kill(id: string): TaskSummary {
    const task = this.#require(id);
    if (task.status !== "running" || task.killRequested) return this.#summary(task);
    task.killRequested = true;
    this.#changed();
    this.#signal(task, "SIGTERM");
    task.killTimer = setTimeout(() => {
      if (task.status === "running") this.#signal(task, "SIGKILL");
    }, this.#killGraceMs);
    task.killTimer.unref?.();
    return this.#summary(task);
  }

  shutdown(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    this.#shuttingDown = true;
    const pending: Promise<TaskInspection>[] = [];
    for (const task of this.#tasks.values()) {
      if (task.timeout) clearTimeout(task.timeout);
      if (task.status === "running") {
        pending.push(this.wait(task.id));
        this.kill(task.id);
      }
    }
    // The session must not dispose its runtime (or exit) before escalation and
    // stream/process cleanup finish. Merely scheduling an unref'ed timer is
    // insufficient in the compiled CLI.
    this.#shutdown = Promise.all(pending).then(() => {});
    return this.#shutdown;
  }

  #notify(task: TaskInspection): void {
    try {
      this.#onComplete(task);
    } catch (error) {
      console.error(`Task completion callback failed for ${task.id}:`, error);
    }
  }

  #append(task: ManagedTask, value: Buffer | string): void {
    task.output.append(value);
    task.baseOffset = task.output.baseOffset;
    task.outputEnd = task.output.endOffset;
    this.#changed();
  }

  #changed(): void {
    for (const listener of this.#listeners) {
      try { listener(); } catch { /* A monitor must never affect task ownership. */ }
    }
  }

  #signal(task: ManagedTask, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && task.pid) process.kill(-task.pid, signal);
      else task.process?.kill(signal);
    } catch {
      task.process?.kill(signal);
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
    const {
      completionOutput: _completionOutput,
      process: _process,
      output: _output,
      timeout: _timeout,
      killTimer: _killTimer,
      killRequested: _killRequested,
      notifyOnComplete: _notifyOnComplete,
      completion: _completion,
      resolveCompletion: _resolveCompletion,
      ...summary
    } = task;
    return { ...summary, ...(summary.agent ? { agent: { ...summary.agent } } : {}) };
  }
}
