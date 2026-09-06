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
export type DiagnosticRecord = Readonly<DiagnosticInput & { version: 1; generated: string }>;
export type DiagnosticRecorder = (input: DiagnosticInput) => void;
export interface DiagnosticReplay {
  records: DiagnosticRecord[];
  scanned: number;
  scanLimit: number;
  scanLimited: boolean;
}
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
const DURABLE_SCAN_LIMIT = 10_000;
const CORE_KEYS = new Set([
  "component",
  "code",
  "outcome",
  "operationId",
  "taskId",
  "dispatch",
  "cancellation",
  "httpStatus",
  "count",
]);
const DURABLE_KEYS = new Set([...CORE_KEYS, "version", "generated"]);

type State = DiagnosticsSnapshot & {
  sink?: (type: string, data: unknown) => void;
  seen: Set<string>;
  generation: number;
  durableUsed: number;
  writing: boolean;
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
      durableUsed: 0,
      writing: false,
    };
    states.set(owner, value);
  }
  return value;
}

/** Returns only the allowlisted projection. Any invalid allowlisted value rejects the whole record. */
function validate(input: unknown, durable = false): DiagnosticRecord | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (durable) {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !DURABLE_KEYS.has(key))) return;
    if (value.version !== 1 || typeof value.generated !== "string") return;
    const parsed = Date.parse(value.generated);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value.generated) return;
  }
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
  const record: DiagnosticInput & { version: 1; generated: string } = {
    version: 1,
    generated: durable ? (value.generated as string) : new Date().toISOString(),
    component: value.component as DiagnosticComponent,
    code: value.code as string,
    outcome: value.outcome as DiagnosticInput["outcome"],
  };
  for (const key of ["operationId", "taskId", "dispatch", "cancellation", "httpStatus", "count"] as const) {
    if (value[key] !== undefined) (record as unknown as Record<string, unknown>)[key] = value[key];
  }
  return Object.freeze(record);
}

function dedupKey(record: DiagnosticRecord): string {
  const { generated: _generated, ...stable } = record;
  return JSON.stringify(stable);
}

export function recordDiagnostic(owner: object, input: DiagnosticInput): void {
  // This API sits on inference error paths: even hostile getters/proxies and reentrant sinks must not escape.
  try {
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
    const key = dedupKey(record);
    if (current.seen.has(key)) {
      current.deduplicated++;
      current.dropped++;
      return;
    }
    if (current.durableUsed >= DURABLE_BUDGET || current.writing) {
      current.budgetDropped++;
      current.dropped++;
      return;
    }
    // Reserve before writing: a throwing/reentrant store cannot induce retries or recursion.
    current.seen.add(key);
    current.durableUsed++;
    current.writing = true;
    try {
      current.sink(DIAGNOSTIC_ENTRY_TYPE, record);
    } catch {
      current.writeFailures++;
      current.dropped++;
    } finally {
      current.writing = false;
    }
  } catch {
    // Diagnostics are strictly best effort and can never disrupt inference.
  }
}

/** Captures the current attachment generation so work from an old session cannot write after a switch. */
export function diagnosticRecorder(owner: object): DiagnosticRecorder {
  const current = state(owner);
  const generation = current.generation;
  return (input) => {
    try {
      if (state(owner).generation === generation) recordDiagnostic(owner, input);
    } catch {}
  };
}

/** Attaches one session's append function and seeds its lifetime durable cap from persisted entries. */
export function attachDiagnosticSink(
  owner: object,
  append: (type: string, data: unknown) => void,
  existingEntries: readonly unknown[] = [],
): () => void {
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
  current.durableUsed = 0;
  current.writing = false;
  try {
    const replay = scanDiagnosticRecords(existingEntries, DURABLE_BUDGET, DURABLE_SCAN_LIMIT);
    current.durableUsed = replay.scanLimited ? DURABLE_BUDGET : replay.records.length;
    for (const record of replay.records) current.seen.add(dedupKey(record));
  } catch {}
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

/** Bounded backward replay. scanLimited reports possible loss when the entry scan cap was reached. */
export function scanDiagnosticRecords(
  entries: readonly unknown[],
  recordLimit = RING_LIMIT,
  scanLimit = DURABLE_SCAN_LIMIT,
): DiagnosticReplay {
  const result: DiagnosticRecord[] = [];
  let scanned = 0;
  let length = 0;
  let unreadable = false;
  try {
    length = Math.max(0, Number.isSafeInteger(entries.length) ? entries.length : 0);
  } catch {
    unreadable = true;
  }
  for (let index = length - 1; index >= 0 && scanned < scanLimit && result.length < recordLimit; index--) {
    scanned++;
    try {
      const raw = entries[index] as { type?: unknown; customType?: unknown; data?: unknown };
      if (raw?.type !== "custom" || raw.customType !== DIAGNOSTIC_ENTRY_TYPE) continue;
      const record = validate(raw.data, true);
      if (record) result.push(record);
    } catch {}
  }
  result.reverse();
  return Object.freeze({
    records: result,
    scanned,
    scanLimit,
    scanLimited: unreadable || (scanned >= scanLimit && length > scanned),
  });
}

export function diagnosticRecords(entries: readonly unknown[]): DiagnosticRecord[] {
  return scanDiagnosticRecords(entries).records;
}
