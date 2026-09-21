import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  getJobResponseDeliverySignal,
  JOB_RESPONSE_ACK_EVENT,
  supportsJobResponseAcknowledgement,
} from "../typescript/job-bridge";
import { type AgentInfo, AgentProgress } from "./agent-progress";
import { BoundedOutputBuffer } from "./output-buffer";
import type { WorkspaceSummary } from "./worktree-workspace";

const MAX_CAPTURE_BYTES = 1_000_000;
const MAX_INSPECT_BYTES = 5_000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const DEFAULT_SHUTDOWN_WATCHDOG_MS = 10_000;
/** Aggregate RAM retained for output of finished jobs. Running jobs keep their own cap. */
export const DEFAULT_COMPLETED_OUTPUT_BUDGET_BYTES = 8_000_000;

function utf8SequenceLength(byte: number): number {
  if ((byte & 0x80) === 0) return 1;
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
  return 1;
}

export function utf8SafeSlice(buffer: Buffer, limit: number): { start: number; end: number } {
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
export type TaskTerminationCause = "timeout" | "user-stop" | "session-shutdown" | "execute-cancellation";
export interface TaskTermination {
  cause: TaskTerminationCause;
  requestedAt: string;
}
/** Metadata-only integration hooks. Never receives command or captured output. */
export interface TaskManagerHooks {
  recordDiagnostic?: (input: {
    component: "jobs";
    code:
      | "JOBS_TASK_SPAWNED"
      | "JOBS_TASK_CHILD_LINKED"
      | "JOBS_TASK_TERMINATION_REQUESTED"
      | "JOBS_TASK_COMPLETED"
      | "JOBS_SHUTDOWN_STARTED"
      | "JOBS_SHUTDOWN_COMPLETED"
      | "JOBS_SHUTDOWN_CLOSURE_TIMEOUT";
    outcome: "success" | "failed" | "blocked" | "cancelled";
    taskId?: string;
    cancellation?: "caller" | "timeout" | "shutdown";
    count?: number;
  }) => void;
  onTaskChild?: (mapping: { taskId: string; kind: TaskLaunch["kind"]; sessionFile?: string }) => void;
  shutdownWatchdogMs?: number;
  /** Aggregate bytes retained for completed output; defaults to 8 MB. */
  completedOutputBudgetBytes?: number;
}

/** Lightweight lifecycle events. Payloads are snapshots; subscribers cannot mutate manager state. */
export type TaskEvent =
  | { type: "spawned"; task: TaskSummary }
  | { type: "updated"; task: TaskSummary }
  | { type: "activity"; task: TaskSummary; source: "output" | "input" }
  | { type: "completed"; task: TaskSummary }
  | { type: "stopping"; task: TaskSummary };
export type TaskEventListener = (event: TaskEvent) => void;

export interface TaskLaunch {
  id?: string;
  agent?: AgentInfo;
  workspace?: WorkspaceSummary;
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

export interface AgentPreparationLaunch {
  id: string;
  displayCommand: string;
  cwd: string;
  workspace: WorkspaceSummary;
  timeoutMs?: number;
  notifyOnComplete?: boolean;
}

export interface TaskSummary {
  agent?: AgentInfo;
  workspace?: WorkspaceSummary;
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
  /** Stable first request to terminate this task, exposed as soon as it is accepted. */
  termination?: TaskTermination;
  /** Last observable output/input activity. This is evidence, not a liveness diagnosis. */
  lastActivityAt?: string;
  /** Whether the manager has not closed child stdin. The child may not be reading it. */
  stdinOpen?: boolean;
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
  preparationController?: AbortController;
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
  readonly #listeners = new Set<TaskEventListener>();
  readonly #hooks: TaskManagerHooks;
  readonly #shutdownWatchdogMs: number;
  readonly #completedOutputBudgetBytes: number;
  readonly #completedOutputOrder: ManagedTask[] = [];
  #completedOutputBytes = 0;
  #shuttingDown = false;
  #shutdown?: Promise<void>;
  #diagnosticFailureReported = false;
  #childFailureReported = false;

  constructor(
    onComplete: (task: TaskInspection) => void,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    hooks: TaskManagerHooks = {},
  ) {
    this.#onComplete = onComplete;
    this.#killGraceMs = killGraceMs;
    this.#hooks = hooks;
    this.#shutdownWatchdogMs = hooks.shutdownWatchdogMs ?? DEFAULT_SHUTDOWN_WATCHDOG_MS;
    const completedBudget = hooks.completedOutputBudgetBytes ?? DEFAULT_COMPLETED_OUTPUT_BUDGET_BYTES;
    if (!Number.isSafeInteger(completedBudget) || completedBudget < 0)
      throw new Error("completedOutputBudgetBytes must be a non-negative safe integer");
    this.#completedOutputBudgetBytes = completedBudget;
  }

  spawn(launch: TaskLaunch): TaskSummary {
    return this.#spawn(launch);
  }

  /** Reserve the final child identity before workspace Git/setup begins. */
  prepareAgent(launch: AgentPreparationLaunch): TaskSummary {
    if (this.#shuttingDown) throw new Error("Task manager is shutting down");
    if (this.#tasks.has(launch.id)) throw new Error("Duplicate task ID");
    let resolveCompletion!: (task: TaskInspection) => void;
    const completion = new Promise<TaskInspection>((resolve) => {
      resolveCompletion = resolve;
    });
    const preparationController = new AbortController();
    const task: ManagedTask = {
      id: launch.id,
      workspace: { ...launch.workspace, preparationStatus: "preparing" },
      kind: "agent",
      command: launch.displayCommand,
      cwd: launch.cwd,
      status: "running",
      startedAt: new Date().toISOString(),
      baseOffset: 0,
      outputEnd: 0,
      timedOut: false,
      lastActivityAt: new Date().toISOString(),
      stdinOpen: false,
      output: new BoundedOutputBuffer(MAX_CAPTURE_BYTES),
      killRequested: false,
      notifyOnComplete: launch.notifyOnComplete ?? false,
      completion,
      resolveCompletion,
      preparationController,
    };
    this.#tasks.set(task.id, task);
    this.#diagnostic({ component: "jobs", code: "JOBS_TASK_SPAWNED", outcome: "success", taskId: task.id });
    this.#emit({ type: "spawned", task: this.#summary(task) });
    if (launch.timeoutMs) {
      task.timeout = setTimeout(() => this.kill(task.id, "timeout"), launch.timeoutMs);
      task.timeout.unref?.();
    }
    return this.#summary(task);
  }

  preparationSignal(id: string): AbortSignal {
    const task = this.#require(id);
    if (!task.preparationController) throw new Error("Task " + id + " is not preparing");
    return task.preparationController.signal;
  }

  updatePreparedWorkspace(id: string, workspace: WorkspaceSummary): TaskSummary {
    const task = this.#requireRunning(id);
    if (!task.preparationController) throw new Error("Task " + id + " is not preparing");
    task.workspace = { ...workspace, preparationStatus: "preparing" };
    task.cwd = workspace.path;
    this.#emit({ type: "updated", task: this.#summary(task) });
    return this.#summary(task);
  }

  updateWorkspaceSetup(id: string, status: NonNullable<WorkspaceSummary["setupStatus"]>): TaskSummary {
    const task = this.#require(id);
    if (!task.workspace?.setupTaskId) throw new Error("Task " + id + " has no workspace setup");
    task.workspace.setupStatus = status;
    this.#emit({ type: "updated", task: this.#summary(task) });
    return this.#summary(task);
  }

  activatePreparedAgent(id: string, launch: Omit<TaskLaunch, "id" | "kind">): TaskSummary {
    return this.#spawn({ ...launch, id, kind: "agent" }, true);
  }

  failPreparedAgent(id: string, error: unknown): TaskSummary {
    const task = this.#requireRunning(id);
    if (!task.preparationController) throw new Error("Task " + id + " is not preparing");
    const message = error instanceof Error ? error.message : String(error);
    this.#append(task, "[workspace preparation failed] " + message + "\n", false);
    if (task.workspace) {
      task.workspace.preparationStatus = "failed";
      task.workspace.preparationError = message.slice(0, 2000);
      if (task.workspace.setupStatus === "running") task.workspace.setupStatus = "failed";
    }
    task.preparationController.abort(error);
    const setupId = task.workspace?.setupTaskId;
    if (setupId && this.#tasks.get(setupId)?.status === "running") this.kill(setupId, "execute-cancellation");
    this.#settlePrepared(task, "failed");
    return this.#summary(task);
  }

  #spawn(launch: TaskLaunch, activatingPrepared = false): TaskSummary {
    if (this.#shuttingDown) throw new Error("Task manager is shutting down");
    const id = launch.id ?? "task_" + randomUUID().slice(0, 8);
    const prepared = activatingPrepared ? this.#requireRunning(id) : undefined;
    if (prepared && (!prepared.preparationController || prepared.process))
      throw new Error("Task " + id + " is not preparing");
    if (!activatingPrepared && this.#tasks.has(id)) throw new Error("Duplicate task ID");
    const child = spawn(launch.command, launch.args ?? [], {
      cwd: launch.cwd,
      env: launch.env ?? process.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let task: ManagedTask;
    if (prepared) {
      task = prepared;
      task.agent = launch.agent ? { ...launch.agent, phase: "starting", events: 0 } : undefined;
      task.workspace = launch.workspace ? { ...launch.workspace, preparationStatus: "ready" } : undefined;
      task.command = launch.displayCommand;
      task.cwd = launch.cwd;
      task.pid = child.pid;
      task.stdinOpen = !launch.closeStdin;
      task.process = child;
      task.preparationController = undefined;
      this.#taskChild({ taskId: id, kind: launch.kind, sessionFile: launch.agent?.sessionFile });
      this.#emit({ type: "updated", task: this.#summary(task) });
    } else {
      let resolveCompletion!: (task: TaskInspection) => void;
      const completion = new Promise<TaskInspection>((resolve) => {
        resolveCompletion = resolve;
      });
      task = {
        id,
        agent: launch.agent ? { ...launch.agent, phase: "starting", events: 0 } : undefined,
        workspace: launch.workspace ? { ...launch.workspace } : undefined,
        kind: launch.kind,
        command: launch.displayCommand,
        cwd: launch.cwd,
        pid: child.pid,
        status: "running",
        startedAt: new Date().toISOString(),
        baseOffset: 0,
        outputEnd: 0,
        timedOut: false,
        lastActivityAt: new Date().toISOString(),
        stdinOpen: !launch.closeStdin,
        process: child,
        output: new BoundedOutputBuffer(MAX_CAPTURE_BYTES),
        killRequested: false,
        notifyOnComplete: launch.notifyOnComplete ?? true,
        completion,
        resolveCompletion,
      };
      this.#tasks.set(id, task);
      this.#diagnostic({ component: "jobs", code: "JOBS_TASK_SPAWNED", outcome: "success", taskId: id });
      this.#taskChild({ taskId: id, kind: launch.kind, sessionFile: launch.agent?.sessionFile });
      this.#emit({ type: "spawned", task: this.#summary(task) });
    }
    if (launch.closeStdin) child.stdin.end();
    // Intentionally merge stdout and stderr for now. Stream labels and strict
    // cross-stream ordering require a structured output format; add that later.
    const progress = task.agent
      ? new AgentProgress(task.agent, (value) => this.#append(task, value, false))
      : undefined;
    child.stdout.on("data", (data: Buffer) => {
      if (progress) {
        // Every raw model stream chunk is activity, including token/thinking
        // events that AgentProgress deliberately does not retain.
        this.#activity(task, "output");
        progress.push(data);
      } else this.#append(task, data);
    });
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
      task.stdinOpen = false;
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
      // Delivery keeps its bounded snapshot, but observers must see the settled
      // manager storage already within the completed-output budget.
      this.#retainCompletedOutput(task);
      resolveTask?.(inspection);
      this.#emit({ type: "completed", task: this.#summary(task) });
      this.#diagnostic({
        component: "jobs",
        code: "JOBS_TASK_COMPLETED",
        outcome: task.termination ? "cancelled" : task.status === "completed" ? "success" : "failed",
        taskId: id,
        ...(task.termination ? { cancellation: this.#cancellation(task.termination.cause) } : {}),
      });
      if (!this.#shuttingDown && task.notifyOnComplete) this.#notify(inspection);
    });

    if (launch.timeoutMs && !task.timeout) {
      task.timeout = setTimeout(() => {
        this.kill(id, "timeout");
      }, launch.timeoutMs);
      task.timeout.unref?.();
    }

    return this.#summary(task);
  }

  /** Running snapshots for monitors/goal mode; no process handles are exposed. */
  pending(): ReadonlyArray<TaskSummary> {
    return this.list().filter((task) => task.status === "running");
  }

  /** Subscribe to event-driven state changes. The returned disposer is idempotent. */
  subscribe(listener: TaskEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
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
  async foreground(
    id: string,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<TaskInspection & { background: boolean }> {
    const task = this.#require(id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      if (waitMs > 0 && !signal?.aborted) {
        await Promise.race([
          this.wait(id),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, waitMs);
          }),
          new Promise<void>((resolve) => {
            onAbort = resolve;
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) resolve();
          }),
        ]);
      }
      if (task.status !== "running" && !signal?.aborted) {
        const result = { ...(await this.wait(id)), background: false };
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
          const acknowledged = () => {
            if (!settled) {
              settled = true;
              cleanup();
            }
          };
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
    if (close && !stdin.destroyed) {
      stdin.end();
      task.stdinOpen = false;
    }
    this.#activity(task, "input");
    return this.#summary(task);
  }

  closeInput(id: string): TaskSummary {
    const task = this.#requireRunning(id);
    task.process!.stdin.end();
    task.stdinOpen = false;
    this.#activity(task, "input");
    return this.#summary(task);
  }

  kill(id: string, cause: TaskTerminationCause = "user-stop"): TaskSummary {
    const task = this.#require(id);
    if (task.status !== "running" || task.killRequested) return this.#summary(task);
    task.killRequested = true;
    task.termination = { cause, requestedAt: new Date().toISOString() };
    task.timedOut = cause === "timeout";
    this.#diagnostic({
      component: "jobs",
      code: "JOBS_TASK_TERMINATION_REQUESTED",
      outcome: "success",
      taskId: id,
      cancellation: this.#cancellation(cause),
    });
    this.#emit({ type: "stopping", task: this.#summary(task) });
    const setupTaskId = task.workspace?.setupTaskId;
    if (setupTaskId && setupTaskId !== id) {
      const setup = this.#tasks.get(setupTaskId);
      if (setup?.status === "running" && !setup.killRequested) this.kill(setupTaskId, cause);
    }
    if (task.preparationController) {
      task.preparationController.abort(
        new Error(cause === "timeout" ? "Workspace preparation timed out" : "Workspace preparation cancelled"),
      );
      if (task.workspace) {
        task.workspace.preparationStatus = "failed";
        task.workspace.preparationError = cause === "timeout" ? "timed out" : "cancelled";
        if (task.workspace.setupStatus === "running") task.workspace.setupStatus = "failed";
      }
      this.#settlePrepared(task, "killed");
    } else {
      this.#signal(task, "SIGTERM");
      task.killTimer = setTimeout(() => {
        if (task.status === "running") this.#signal(task, "SIGKILL");
      }, this.#killGraceMs);
      task.killTimer.unref?.();
    }
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
        this.kill(task.id, "session-shutdown");
      }
    }
    this.#diagnostic({
      component: "jobs",
      code: "JOBS_SHUTDOWN_STARTED",
      outcome: "success",
      count: pending.length,
    });
    // Keep the runtime alive for escalation/close, but bound a missing child close event.
    this.#shutdown = (async () => {
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const withinBound = await Promise.race([
        Promise.all(pending).then(() => true),
        new Promise<false>((resolve) => {
          watchdog = setTimeout(() => resolve(false), this.#shutdownWatchdogMs);
        }),
      ]);
      if (watchdog) clearTimeout(watchdog);
      if (!withinBound) {
        const count = [...this.#tasks.values()].filter((task) => task.status === "running").length;
        for (const task of this.#tasks.values()) {
          if (task.status !== "running") continue;
          this.#signal(task, "SIGKILL");
          // The watchdog bounds runtime ownership as well as the returned
          // promise. Do not fabricate completion when close was not observed.
          task.process?.stdin.destroy();
          task.process?.stdout.destroy();
          task.process?.stderr.destroy();
          task.process?.unref();
        }
        this.#diagnostic({ component: "jobs", code: "JOBS_SHUTDOWN_CLOSURE_TIMEOUT", outcome: "blocked", count });
      }
      this.#listeners.clear();
      this.#diagnostic({
        component: "jobs",
        code: "JOBS_SHUTDOWN_COMPLETED",
        outcome: withinBound ? "success" : "failed",
        count: pending.length,
      });
    })();
    return this.#shutdown;
  }

  #settlePrepared(task: ManagedTask, status: "failed" | "killed"): void {
    if (task.timeout) clearTimeout(task.timeout);
    task.timeout = undefined;
    task.completedAt = new Date().toISOString();
    task.status = status;
    task.stdinOpen = false;
    task.preparationController = undefined;
    const inspection = this.inspect(task.id, Math.max(task.baseOffset, task.outputEnd - MAX_INSPECT_BYTES));
    const resolveTask = task.resolveCompletion;
    task.completion = undefined;
    task.resolveCompletion = undefined;
    this.#retainCompletedOutput(task);
    resolveTask?.(inspection);
    this.#emit({ type: "completed", task: this.#summary(task) });
    this.#diagnostic({
      component: "jobs",
      code: "JOBS_TASK_COMPLETED",
      outcome: task.termination ? "cancelled" : "failed",
      taskId: task.id,
      ...(task.termination ? { cancellation: this.#cancellation(task.termination.cause) } : {}),
    });
    if (!this.#shuttingDown && task.notifyOnComplete) this.#notify(inspection);
  }

  #retainCompletedOutput(task: ManagedTask): void {
    const completionBytes = task.completionOutput === undefined ? 0 : Buffer.byteLength(task.completionOutput);
    if (task.output.retainedBytes === 0 && completionBytes === 0) return;
    this.#completedOutputOrder.push(task);
    this.#completedOutputBytes += task.output.retainedBytes + completionBytes;

    while (this.#completedOutputBytes > this.#completedOutputBudgetBytes) {
      const oldest = this.#completedOutputOrder[0];
      if (!oldest) break;
      const excess = this.#completedOutputBytes - this.#completedOutputBudgetBytes;
      const discarded = oldest.output.discardPrefix(excess);
      this.#completedOutputBytes -= discarded;
      oldest.baseOffset = oldest.output.baseOffset;

      if (this.#completedOutputBytes > this.#completedOutputBudgetBytes && oldest.completionOutput !== undefined) {
        this.#completedOutputBytes -= Buffer.byteLength(oldest.completionOutput);
        oldest.completionOutput = undefined;
      }
      if (oldest.output.retainedBytes === 0 && oldest.completionOutput === undefined)
        this.#completedOutputOrder.shift();
      else if (discarded === 0) break;
    }
  }

  #diagnostic(input: Parameters<NonNullable<TaskManagerHooks["recordDiagnostic"]>>[0]): void {
    try {
      this.#hooks.recordDiagnostic?.(input);
    } catch {
      if (!this.#diagnosticFailureReported) {
        this.#diagnosticFailureReported = true;
        console.error("Task diagnostic callback failed");
      }
    }
  }

  #taskChild(mapping: Parameters<NonNullable<TaskManagerHooks["onTaskChild"]>>[0]): void {
    try {
      this.#hooks.onTaskChild?.(mapping);
      if (mapping.sessionFile)
        this.#diagnostic({
          component: "jobs",
          code: "JOBS_TASK_CHILD_LINKED",
          outcome: "success",
          taskId: mapping.taskId,
        });
    } catch {
      if (!this.#childFailureReported) {
        this.#childFailureReported = true;
        console.error("Task child lifecycle callback failed");
      }
    }
  }

  #cancellation(cause: TaskTerminationCause): "caller" | "timeout" | "shutdown" {
    return cause === "timeout" ? "timeout" : cause === "session-shutdown" ? "shutdown" : "caller";
  }

  #notify(task: TaskInspection): void {
    try {
      this.#onComplete(task);
    } catch (error) {
      console.error(`Task completion callback failed for ${task.id}:`, error);
    }
  }

  #append(task: ManagedTask, value: Buffer | string, activity = true): void {
    task.output.append(value);
    task.baseOffset = task.output.baseOffset;
    task.outputEnd = task.output.endOffset;
    if (activity) this.#activity(task, "output");
  }

  #activity(task: ManagedTask, source: "output" | "input"): void {
    if (task.status !== "running") return;
    task.lastActivityAt = new Date().toISOString();
    this.#emit({ type: "activity", task: this.#summary(task), source });
  }

  #emit(event: TaskEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Task event listener failed:", error);
      }
    }
  }

  #signal(task: ManagedTask, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && task.pid) process.kill(-task.pid, signal);
      else task.process?.kill(signal);
    } catch {
      try {
        task.process?.kill(signal);
      } catch {
        /* Process may already be gone. */
      }
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
    return {
      ...summary,
      ...(summary.agent ? { agent: { ...summary.agent } } : {}),
      ...(summary.workspace ? { workspace: { ...summary.workspace } } : {}),
      ...(summary.termination ? { termination: { ...summary.termination } } : {}),
    };
  }
}
