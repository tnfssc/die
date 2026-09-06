import { recordDiagnostic } from "../diagnostics";
import type { TaskEvent, TaskInspection, TaskManager, TaskSummary } from "./task-manager";

export const DEFAULT_QUIET_MS = 5 * 60_000;
export const DEFAULT_REVIEW_MS = 10 * 60_000;
export const MAX_SNOOZE_MINUTES = 55;
export const MAX_ATTENTION_NOTIFICATION_CHARS = 5_000;

export interface AttentionClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
const systemClock: AttentionClock = {
  now: Date.now,
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export type AttentionReason = "quiet" | "review";
export interface AttentionNotice {
  id: string;
  reasons: AttentionReason[];
  observedAt: string;
  elapsedMs: number;
  quietForMs: number;
  outputBytes: number;
  stdinOpen: boolean;
  task: TaskInspection;
}
interface AttentionState {
  lastActivityMs: number;
  quietEligibleMs: number;
  nextReviewMs: number;
  snoozedUntilMs: number;
  quietNotified: boolean;
  watchEnabled: boolean;
}
export interface AttentionDiagnostics {
  activeJobs: number;
  timerArmed: boolean;
  timerCallbacks: number;
  timerSchedules: number;
  notices: number;
  /** Number of scheduler states examined by deadline/policy scans. */
  stateVisits: number;
}
export interface AttentionOptions {
  quietMs?: number;
  reviewMs?: number;
  clock?: AttentionClock;
}

/**
 * One deadline timer for all jobs in an owning session. Activity only updates a
 * scalar deadline; noisy output does not recreate timers. State exists only for
 * running tasks and is removed synchronously on completion.
 */
export class JobAttentionScheduler {
  readonly #states = new Map<string, AttentionState>();
  readonly #clock: AttentionClock;
  readonly #quietMs: number;
  readonly #reviewMs: number;
  readonly #manager: TaskManager;
  readonly #onNotice: (notices: AttentionNotice[]) => void;
  readonly #unsubscribe: () => void;
  readonly #waiters = new Set<() => void>();
  readonly #inspectFailures = new Set<string>();
  #timer?: unknown;
  #scheduledAt = Infinity;
  #disposed = false;
  #timerCallbacks = 0;
  #timerSchedules = 0;
  #noticeCount = 0;
  #stateVisits = 0;

  constructor(manager: TaskManager, onNotice: (notices: AttentionNotice[]) => void, options: AttentionOptions = {}) {
    this.#manager = manager;
    this.#onNotice = onNotice;
    this.#clock = options.clock ?? systemClock;
    this.#quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
    this.#reviewMs = options.reviewMs ?? DEFAULT_REVIEW_MS;
    if (
      !Number.isFinite(this.#quietMs) ||
      !Number.isFinite(this.#reviewMs) ||
      !(this.#quietMs > 0) ||
      !(this.#reviewMs > 0)
    )
      throw new Error("Attention intervals must be finite and positive");
    const now = this.#now();
    for (const task of manager.pending()) this.#add(task, now);
    this.#unsubscribe = manager.subscribe((event) => this.#event(event));
    this.#schedule();
  }

  setWatch(id: string, enabled: boolean): TaskSummary {
    const task = this.#running(id);
    const state = this.#states.get(id)!;
    state.watchEnabled = enabled;
    if (enabled) {
      const now = this.#now();
      // Re-enabling grants a fresh grace period, but is not fabricated I/O.
      state.quietEligibleMs = now + this.#quietMs;
      state.nextReviewMs = now + this.#reviewMs;
      state.snoozedUntilMs = 0;
      state.quietNotified = false;
    }
    // Explicit policy changes may remove the final deadline entirely.
    this.#schedule();
    return task;
  }

  snooze(id: string, minutes: number): TaskSummary {
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_SNOOZE_MINUTES) {
      throw new Error(`Snooze minutes must be greater than 0 and at most ${MAX_SNOOZE_MINUTES}`);
    }
    const task = this.#running(id);
    const state = this.#states.get(id)!;
    const until = this.#now() + minutes * 60_000;
    state.snoozedUntilMs = until;
    state.nextReviewMs = until;
    state.quietNotified = false;
    // As with activity, a later deadline never recreates the current timer.
    this.#schedule();
    return task;
  }

  isWatched(id: string): boolean {
    return this.#states.get(id)?.watchEnabled ?? false;
  }
  diagnostics(): AttentionDiagnostics {
    return {
      activeJobs: this.#states.size,
      timerArmed: this.#timer !== undefined,
      timerCallbacks: this.#timerCallbacks,
      timerSchedules: this.#timerSchedules,
      notices: this.#noticeCount,
      stateVisits: this.#stateVisits,
    };
  }

  /** Resolves on the next attention batch. Used by print/JSON agent_end waits. */
  waitForNotice(signal?: AbortSignal): Promise<void> {
    if (this.#disposed || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.#waiters.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      this.#waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#scheduledAt = Infinity;
    this.#states.clear();
    this.#inspectFailures.clear();
    for (const waiter of [...this.#waiters]) waiter();
  }

  #event(event: TaskEvent): void {
    if (this.#disposed) return;
    const now = this.#now();
    if (event.type === "spawned") {
      const state = this.#add(event.task, now, true);
      this.#armIfEarlier(this.#deadline(state));
    } else if (event.type === "activity") {
      const state = this.#states.get(event.task.id);
      if (state) {
        state.lastActivityMs = now;
        if (state.quietNotified) {
          state.quietNotified = false;
          this.#armIfEarlier(this.#deadline(state));
        }
      }
    } else if (event.type === "completed") {
      this.#states.delete(event.task.id);
      this.#inspectFailures.delete(event.task.id);
      if (!this.#states.size) this.#clearTimer();
    }
  }

  #add(task: TaskSummary, now: number, liveEvent = false): AttentionState {
    const started = liveEvent ? now : this.#timestamp(task.startedAt, now);
    const activity = liveEvent ? now : this.#timestamp(task.lastActivityAt, started, now);
    const state = {
      lastActivityMs: activity,
      quietEligibleMs: 0,
      nextReviewMs: started + this.#reviewMs,
      snoozedUntilMs: 0,
      quietNotified: false,
      watchEnabled: true,
    };
    this.#states.set(task.id, state);
    return state;
  }

  #deadline(state: AttentionState): number {
    if (!state.watchEnabled) return Infinity;
    const quiet = state.quietNotified
      ? Infinity
      : Math.max(state.lastActivityMs + this.#quietMs, state.quietEligibleMs, state.snoozedUntilMs);
    return Math.min(quiet, state.nextReviewMs);
  }

  #schedule(): void {
    if (this.#disposed) return;
    let next = Infinity;
    for (const state of this.#states.values()) {
      this.#stateVisits++;
      next = Math.min(next, this.#deadline(state));
    }
    if (!Number.isFinite(next)) {
      if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#scheduledAt = Infinity;
      return;
    }
    // Do not postpone/recreate an existing timer on output. It will recheck the
    // moved deadline once, then arm the next actual deadline.
    if (this.#timer !== undefined && this.#scheduledAt <= next) return;
    if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer);
    this.#scheduledAt = next;
    this.#timerSchedules++;
    this.#timer = this.#clock.setTimeout(() => this.#fire(), Math.min(2_147_483_647, Math.max(0, next - this.#now())));
  }

  #fire(): void {
    this.#timer = undefined;
    this.#scheduledAt = Infinity;
    this.#timerCallbacks++;
    if (this.#disposed) return;
    const now = this.#clock.now();
    const notices: AttentionNotice[] = [];
    const pending = new Map(this.#manager.pending().map((task) => [task.id, task]));
    for (const [id, state] of this.#states) {
      this.#stateVisits++;
      if (!state.watchEnabled || now < state.snoozedUntilMs) continue;
      const reasons: AttentionReason[] = [];
      if (!state.quietNotified && now >= Math.max(state.lastActivityMs + this.#quietMs, state.quietEligibleMs)) {
        reasons.push("quiet");
        state.quietNotified = true;
      }
      if (now >= state.nextReviewMs) {
        reasons.push("review");
        const intervals = Math.floor((now - state.nextReviewMs) / this.#reviewMs) + 1;
        state.nextReviewMs += intervals * this.#reviewMs;
      }
      if (!reasons.length) continue;
      const summary = pending.get(id);
      if (!summary) {
        // pending() is the authoritative terminal/missing check. Only then is
        // it safe to stop monitoring this task.
        this.#states.delete(id);
        this.#inspectFailures.delete(id);
        continue;
      }
      let task: TaskInspection;
      try {
        task = this.#manager.inspect(id, Math.max(summary.baseOffset, summary.outputEnd - 1000), 1000);
        this.#inspectFailures.delete(id);
      } catch {
        // Inspection can fail transiently while the task is still confirmed
        // pending. Retain scheduler state and report the episode only once.
        if (!this.#inspectFailures.has(id)) {
          this.#inspectFailures.add(id);
          recordDiagnostic(this.#manager, {
            component: "attention",
            code: "inspection_failed",
            outcome: "failed",
            taskId: id,
          });
        }
        continue;
      }
      notices.push({
        id,
        reasons,
        observedAt: new Date(now).toISOString(),
        elapsedMs: Math.max(0, now - Date.parse(task.startedAt)),
        quietForMs: Math.max(0, now - state.lastActivityMs),
        outputBytes: task.outputEnd,
        stdinOpen: task.stdinOpen ?? false,
        task,
      });
    }
    if (notices.length) {
      this.#noticeCount += notices.length;
      try {
        this.#onNotice(notices);
      } catch (error) {
        console.error("Job attention callback failed:", error);
      }
      for (const waiter of [...this.#waiters]) waiter();
    }
    this.#schedule();
  }

  #armIfEarlier(deadline: number): void {
    if (!Number.isFinite(deadline) || (this.#timer !== undefined && this.#scheduledAt <= deadline)) return;
    if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer);
    this.#scheduledAt = deadline;
    this.#timerSchedules++;
    this.#timer = this.#clock.setTimeout(
      () => this.#fire(),
      Math.min(2_147_483_647, Math.max(0, deadline - this.#now())),
    );
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#scheduledAt = Infinity;
  }

  #now(): number {
    const now = this.#clock.now();
    if (!Number.isFinite(now)) throw new Error("Attention clock must return a finite timestamp");
    return now;
  }

  #timestamp(value: string | undefined, fallback: number, reference = fallback): number {
    const parsed = value === undefined ? NaN : Date.parse(value);
    if (!Number.isFinite(parsed)) return fallback;
    // A task spawned just after a fake/test clock snapshot can be a few
    // milliseconds in its future. Never manufacture future activity.
    return Math.min(parsed, reference);
  }

  #running(id: string): TaskSummary {
    const task = this.#manager.list().find((item) => item.id === id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    if (task.status !== "running" || !this.#states.has(id)) throw new Error(`Task ${id} is ${task.status}`);
    return task;
  }
}

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000),
    seconds = Math.floor((ms % 60_000) / 1000);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Bounded evidence-only parent message; it never recommends an automatic kill. */
export function formatAttentionNotification(
  notices: AttentionNotice[],
  limit = MAX_ATTENTION_NOTIFICATION_CHARS,
): string {
  if (!notices.length || limit <= 0) return "";
  let text = `${notices.length} running job${notices.length === 1 ? "" : "s"} reached an attention checkpoint. Jobs continue running.`;
  let included = 0;
  for (const notice of notices) {
    const output = notice.task.output.trim().replaceAll(/\s+/g, " ");
    const block =
      `\n\n${notice.id} [${notice.reasons.join("+")}] elapsed=${duration(notice.elapsedMs)} quiet=${duration(notice.quietForMs)} output=${notice.outputBytes}B stdin=${notice.stdinOpen ? "open" : "closed"}` +
      (output
        ? `\nRecent output: ${output.length > 500 ? "\u2026" + output.slice(-499) : output}`
        : "\nNo retained output observed.");
    if (included > 0 && text.length + block.length > limit - 260) break;
    text += block.slice(0, Math.max(0, limit - text.length - 180));
    included++;
  }
  if (included < notices.length) {
    const omitted = `\n\n${notices.length - included} additional attention checkpoint${notices.length - included === 1 ? "" : "s"} omitted. IDs: ${notices
      .slice(included, included + 8)
      .map((item) => item.id)
      .join(" ")}${notices.length - included > 8 ? ` \u2026 (+${notices.length - included - 8} more)` : ""}`;
    text += omitted.slice(0, Math.max(0, limit - text.length - 150));
  }
  const instruction =
    "\n\nInspect before deciding. You may provide/close input, stop obsolete work, leave it running, snooze up to 55 minutes, or disable watching for an expected persistent service.";
  text += instruction.slice(0, Math.max(0, limit - text.length));
  return text.slice(0, limit);
}
