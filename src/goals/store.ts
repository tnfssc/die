import { randomUUID } from "node:crypto";
import { recordDiagnostic } from "../diagnostics";
import { GOAL_STATUSES, type GoalEntry, type GoalState, type GoalStatus } from "./types";

export const GOAL_ENTRY_TYPE = "die-goal";
const MAX_FIELD = 4_000;
const MAX_ITEMS = 20;
const MAX_PROGRESS_ITEMS = 8;
const MAX_PROGRESS_FIELD = 500;
const MAX_AGGREGATE_TEXT = 12_000;

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  if (value.length > MAX_FIELD) throw new Error(`${name} is too long`);
  return value.trim();
}

function strings(value: unknown, name: string, required = false): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} must be an array of nonempty strings`);
  }
  if (required && value.length === 0) throw new Error(`${name} is required`);
  if (value.length > MAX_ITEMS) throw new Error(`${name} has too many items`);
  return value.map((item) => text(item, name));
}

function optionalText(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : text(value, name);
}

function aggregateText(goal: GoalState): number {
  return [
    goal.objective,
    ...goal.criteria,
    ...goal.constraints,
    ...(goal.progress ?? []),
    ...(goal.pendingJobIds ?? []),
    goal.evidence,
    goal.blocker,
    goal.pauseReason,
  ]
    .filter((item): item is string => typeof item === "string")
    .reduce((total, item) => total + item.length, 0);
}

function validateAggregate(goal: GoalState): void {
  if (aggregateText(goal) > MAX_AGGREGATE_TEXT) throw new Error("Goal payload is too large");
}

function progressText(value: unknown): string {
  const result = text(value, "progress evidence");
  if (result.length > MAX_PROGRESS_FIELD) throw new Error("progress evidence is too long");
  return result;
}

function parseGoal(value: unknown): GoalState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  try {
    const status = raw.status;
    if (typeof status !== "string" || !GOAL_STATUSES.includes(status as GoalStatus)) return undefined;
    if (typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) || raw.revision < 1) return undefined;

    const goal: GoalState = {
      id: text(raw.id, "id"),
      revision: raw.revision,
      objective: text(raw.objective, "objective"),
      criteria: strings(raw.criteria, "criteria", true),
      constraints: strings(raw.constraints, "constraints"),
      status: status as GoalStatus,
      createdAt: text(raw.createdAt, "createdAt"),
      updatedAt: text(raw.updatedAt, "updatedAt"),
    };

    if (raw.progress !== undefined) {
      goal.progress = strings(raw.progress, "progress").map(progressText);
      if (goal.progress.length > MAX_PROGRESS_ITEMS) return undefined;
    }
    if (goal.status === "completed") goal.evidence = text(raw.evidence, "completion evidence");
    if (goal.status === "blocked") goal.blocker = text(raw.blocker, "blocker explanation");
    if (goal.status === "waiting") goal.pendingJobIds = strings(raw.pendingJobIds, "pendingJobIds", true);
    if (goal.status === "paused") goal.pauseReason = text(raw.pauseReason, "pause reason");
    validateAggregate(goal);
    return goal;
  } catch {
    return undefined;
  }
}

function parseEntry(raw: unknown): GoalEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const entry = raw as { type?: unknown; customType?: unknown; data?: unknown };
  if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) return undefined;
  if (!entry.data || typeof entry.data !== "object") return undefined;
  const data = entry.data as Record<string, unknown>;
  if (data.version !== 1 || typeof data.at !== "string") return undefined;
  if (data.operation === "clear") return { version: 1, operation: "clear", at: data.at };
  if (data.operation !== "set" && data.operation !== "update") return undefined;
  const goal = parseGoal(data.goal);
  return goal ? { version: 1, operation: data.operation, goal, at: data.at } : undefined;
}

export function latestGoal(entries: readonly unknown[], diagnosticOwner?: object): GoalState | undefined {
  let goal: GoalState | undefined;
  let restoreFailure: { taskIds: string[] } | undefined;
  const waitingIds = (value: unknown): string[] => {
    if (!value || typeof value !== "object") return [];
    const data = (value as { data?: unknown }).data;
    if (!data || typeof data !== "object") return [];
    const candidate = (data as { goal?: unknown }).goal;
    if (!candidate || typeof candidate !== "object") return [];
    const ids = (candidate as { pendingJobIds?: unknown }).pendingJobIds;
    return Array.isArray(ids) ? ids.slice(0, MAX_ITEMS).filter((id): id is string => typeof id === "string") : [];
  };
  for (const raw of entries) {
    const marker = raw as { type?: unknown; customType?: unknown } | undefined;
    if (marker?.type !== "custom" || marker.customType !== GOAL_ENTRY_TYPE) continue;

    // Every entry of our custom type is an authority boundary. A corrupt or
    // future-version entry must fail closed rather than revive an older goal.
    const priorWaitingIds = goal?.status === "waiting" ? (goal.pendingJobIds ?? []) : [];
    const entry = parseEntry(raw);
    if (!entry) {
      restoreFailure = { taskIds: [...new Set([...priorWaitingIds, ...waitingIds(raw)])] };
      goal = undefined;
      continue;
    }
    if (entry.operation === "clear") {
      goal = undefined;
      restoreFailure = undefined;
      continue;
    }
    const candidate = entry.goal!;
    if (entry.operation === "set") {
      goal = structuredClone(candidate);
      restoreFailure = undefined;
    } else if (goal && candidate.id === goal.id && candidate.revision > goal.revision) {
      goal = structuredClone(candidate);
      restoreFailure = undefined;
    } else {
      restoreFailure = {
        taskIds: [
          ...new Set([...priorWaitingIds, ...(candidate.status === "waiting" ? (candidate.pendingJobIds ?? []) : [])]),
        ],
      };
      goal = undefined;
    }
  }
  if (restoreFailure && diagnosticOwner) {
    // Always diagnose the authority boundary, even when forged task references
    // would themselves be rejected by the closed diagnostic schema.
    const refs = [
      undefined,
      ...restoreFailure.taskIds.filter((id) => /^task_[A-Za-z0-9]{1,64}$/.test(id)).slice(0, MAX_ITEMS),
    ];
    for (const taskId of refs) {
      recordDiagnostic(diagnosticOwner, {
        component: "resume",
        code: "state_invalid",
        outcome: "fallback",
        ...(taskId ? { taskId } : {}),
      });
    }
  }
  return goal;
}

export class GoalStore {
  #goal?: GoalState;

  constructor(
    private readonly append: (type: string, data: GoalEntry) => void,
    entries: readonly unknown[] = [],
    private readonly now = () => new Date().toISOString(),
    diagnosticOwner?: object,
  ) {
    this.#goal = latestGoal(entries, diagnosticOwner);
  }

  get(): GoalState | undefined {
    return this.#goal ? structuredClone(this.#goal) : undefined;
  }

  set(input: { objective: unknown; criteria: unknown; constraints: unknown }): GoalState {
    const at = this.now();
    const goal: GoalState = {
      id: randomUUID(),
      revision: (this.#goal?.revision ?? 0) + 1,
      objective: text(input.objective, "objective"),
      criteria: strings(input.criteria, "criteria", true),
      constraints: strings(input.constraints, "constraints"),
      status: "active",
      createdAt: at,
      updatedAt: at,
    };
    validateAggregate(goal);
    return this.#save("set", goal);
  }

  update(
    input: {
      status: unknown;
      evidence?: unknown;
      blocker?: unknown;
      pendingJobIds?: unknown;
      reason?: unknown;
      progress?: unknown;
    },
    runningJobs: ReadonlySet<string> = new Set(),
  ): GoalState {
    if (!this.#goal) throw new Error("No goal is set");
    if (typeof input.status !== "string" || !GOAL_STATUSES.includes(input.status as GoalStatus)) {
      throw new Error("Invalid goal status");
    }

    const status = input.status as GoalStatus;
    const goal: GoalState = {
      ...this.#goal,
      status,
      revision: this.#goal.revision + 1,
      updatedAt: this.now(),
    };
    delete goal.evidence;
    delete goal.blocker;
    delete goal.pendingJobIds;
    delete goal.pauseReason;

    if (status === "completed") goal.evidence = text(input.evidence, "completion evidence");
    if (status === "blocked") goal.blocker = text(input.blocker, "blocker explanation");
    if (status === "waiting") {
      goal.pendingJobIds = strings(input.pendingJobIds, "pendingJobIds", true);
      const unknown = goal.pendingJobIds.filter((id) => !runningJobs.has(id));
      if (unknown.length > 0) {
        throw new Error(`Waiting requires running jobs owned by this agent: ${unknown.join(", ")}`);
      }
    }
    if (status === "paused") {
      goal.pauseReason = optionalText(input.reason, "pause reason") ?? "Paused";
    }
    if (input.progress !== undefined) {
      if (status !== "active") throw new Error("progress evidence requires active status");
      const milestone = progressText(input.progress);
      const prior = goal.progress ?? [];
      if (!prior.includes(milestone)) goal.progress = [...prior, milestone].slice(-MAX_PROGRESS_ITEMS);
    }
    validateAggregate(goal);
    return this.#save("update", goal);
  }

  clear(): void {
    const entry: GoalEntry = { version: 1, operation: "clear", at: this.now() };
    this.append(GOAL_ENTRY_TYPE, entry);
    this.#goal = undefined;
  }

  #save(operation: "set" | "update", goal: GoalState): GoalState {
    const saved = structuredClone(goal);
    this.append(GOAL_ENTRY_TYPE, {
      version: 1,
      operation,
      goal: saved,
      at: saved.updatedAt,
    });
    this.#goal = saved;
    return this.get()!;
  }
}
