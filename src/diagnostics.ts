/** Privacy-bounded operational diagnostics shared by extension components. */
export const DIAGNOSTIC_ENTRY_TYPE = "die-diagnostic";

export const DIAGNOSTIC_CODES = [
  "capture_missing",
  "identity_stale",
  "payload_missing",
  "headers_missing",
  "payload_incompatible",
  "coverage_incomplete",
  "custom_instructions",
  "opaque_checkpoint",
  "preparation_failed",
  "capacity_insufficient",
  "provider_failed",
  "provider_cancelled",
  "caller_aborted",
  "response_invalid",
  "transport_error",
  "http_rejected",
  "diagnostic_write_failed",
  "observer_failed",
  "request_blocked",
  "state_invalid",
  "state_write_failed",
  "shake_applied",
  "shake_noop",
  "shutdown",
  "stop_requested",
  "timeout",
  "process_exit",
  "bridge_disconnected",
  "protocol_invalid",
  "frame_oversize",
  "inspection_failed",
  "metadata_invalid",
  "metadata_unreadable",
  "settings_invalid",
  "delivery_failed",
] as const;

export type DiagnosticComponent =
  | "compaction"
  | "provider"
  | "cache"
  | "fast"
  | "shake"
  | "jobs"
  | "bridge"
  | "attention"
  | "resume"
  | "settings"
  | "herdr"
  | "observer";
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
export interface DiagnosticInput {
  component: DiagnosticComponent;
  code: string;
  outcome: "success" | "failed" | "fallback" | "blocked" | "cancelled" | "noop";
  operationId?: string;
  taskId?: string;
  dispatch?: "none" | "initiated" | "response" | "unknown";
  cancellation?: "caller" | "provider" | "timeout" | "shutdown" | "safety";
  httpStatus?: number;
  count?: number;
}
export type DiagnosticRecord = Readonly<DiagnosticInput>;
export interface DiagnosticsSnapshot {
  records: DiagnosticRecord[];
  accepted: number;
  dropped: number;
  invalid: number;
  deduplicated: number;
  budgetDropped: number;
  writeFailures: number;
}

const COMPONENTS = new Set([
  "compaction",
  "provider",
  "cache",
  "fast",
  "shake",
  "jobs",
  "bridge",
  "attention",
  "resume",
  "settings",
  "herdr",
  "observer",
]);
const CODES = new Set<string>(DIAGNOSTIC_CODES);
const OUTCOMES = new Set(["success", "failed", "fallback", "blocked", "cancelled", "noop"]);
const DISPATCH = new Set(["none", "initiated", "response", "unknown"]);
const CANCELLATION = new Set(["caller", "provider", "timeout", "shutdown", "safety"]);
const ID = /^(?:task_[A-Za-z0-9]{1,64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const RING_LIMIT = 100;
const DURABLE_BUDGET = 128;

type State = DiagnosticsSnapshot & {
  sink?: (type: string, data: unknown) => void;
  seen: Set<string>;
  generation: number;
};
const states = new WeakMap<object, State>();
function state(owner: object): State {
  let value = states.get(owner);
  if (!value) {
    value = {
      records: [],
      accepted: 0,
      dropped: 0,
      invalid: 0,
      deduplicated: 0,
      budgetDropped: 0,
      writeFailures: 0,
      seen: new Set(),
      generation: 0,
    };
    states.set(owner, value);
  }
  return value;
}

/** Returns only the allowlisted projection. Any invalid allowlisted value rejects the whole record. */
function validate(input: unknown): DiagnosticRecord | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (
    !COMPONENTS.has(value.component as string) ||
    !CODES.has(value.code as string) ||
    !OUTCOMES.has(value.outcome as string)
  )
    return;
  if (value.operationId !== undefined && (typeof value.operationId !== "string" || !ID.test(value.operationId))) return;
  if (value.taskId !== undefined && (typeof value.taskId !== "string" || !ID.test(value.taskId))) return;
  if (value.dispatch !== undefined && !DISPATCH.has(value.dispatch as string)) return;
  if (value.cancellation !== undefined && !CANCELLATION.has(value.cancellation as string)) return;
  if (
    value.httpStatus !== undefined &&
    (!Number.isInteger(value.httpStatus) || (value.httpStatus as number) < 100 || (value.httpStatus as number) > 599)
  )
    return;
  if (
    value.count !== undefined &&
    (!Number.isSafeInteger(value.count) || (value.count as number) < 0 || (value.count as number) > 1_000_000_000)
  )
    return;
  const record: DiagnosticInput = {
    component: value.component as DiagnosticComponent,
    code: value.code as string,
    outcome: value.outcome as DiagnosticInput["outcome"],
  };
  if (value.operationId !== undefined) record.operationId = value.operationId as string;
  if (value.taskId !== undefined) record.taskId = value.taskId as string;
  if (value.dispatch !== undefined) record.dispatch = value.dispatch as DiagnosticInput["dispatch"];
  if (value.cancellation !== undefined) record.cancellation = value.cancellation as DiagnosticInput["cancellation"];
  if (value.httpStatus !== undefined) record.httpStatus = value.httpStatus as number;
  if (value.count !== undefined) record.count = value.count as number;
  return Object.freeze(record);
}

export function recordDiagnostic(owner: object, input: DiagnosticInput): void {
  if (!owner || (typeof owner !== "object" && typeof owner !== "function")) return;
  const current = state(owner);
  const record = validate(input);
  if (!record) {
    current.invalid++;
    current.dropped++;
    return;
  }
  current.accepted++;
  current.records.push(record);
  if (current.records.length > RING_LIMIT) current.records.splice(0, current.records.length - RING_LIMIT);
  if (!current.sink) return;
  const key = JSON.stringify(record);
  if (current.seen.has(key)) {
    current.deduplicated++;
    current.dropped++;
    return;
  }
  if (current.seen.size >= DURABLE_BUDGET) {
    current.budgetDropped++;
    current.dropped++;
    return;
  }
  // Reserve before writing: a throwing store cannot induce unbounded retries or recursion.
  current.seen.add(key);
  try {
    current.sink(DIAGNOSTIC_ENTRY_TYPE, record);
  } catch {
    current.writeFailures++;
    current.dropped++;
  }
}

/** Attaches one session's append function. Reattachment starts a fresh bounded session view/budget. */
export function attachDiagnosticSink(owner: object, append: (type: string, data: unknown) => void): () => void {
  const current = state(owner);
  const generation = ++current.generation;
  current.sink = append;
  current.records = [];
  current.accepted =
    current.dropped =
    current.invalid =
    current.deduplicated =
    current.budgetDropped =
    current.writeFailures =
      0;
  current.seen.clear();
  return () => {
    if (current.generation === generation) current.sink = undefined;
  };
}

export function inspectDiagnostics(owner: object): DiagnosticsSnapshot {
  const current = states.get(owner);
  if (!current)
    return { records: [], accepted: 0, dropped: 0, invalid: 0, deduplicated: 0, budgetDropped: 0, writeFailures: 0 };
  return Object.freeze({
    records: current.records.slice(),
    accepted: current.accepted,
    dropped: current.dropped,
    invalid: current.invalid,
    deduplicated: current.deduplicated,
    budgetDropped: current.budgetDropped,
    writeFailures: current.writeFailures,
  });
}

/** Validates durable records too, so forged legacy fields never reach inspection output. */
export function diagnosticRecords(entries: readonly unknown[]): DiagnosticRecord[] {
  const result: DiagnosticRecord[] = [];
  for (const raw of entries.slice(-512)) {
    const entry = raw as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry?.type !== "custom" || entry.customType !== DIAGNOSTIC_ENTRY_TYPE) continue;
    const record = validate(entry.data);
    if (record) result.push(record);
  }
  return result.slice(-RING_LIMIT);
}
