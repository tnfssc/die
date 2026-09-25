/** Persisted manual-shake checkpoint contract. Keep validation and wire values stable. */
export const MANUAL_SHAKE_ENTRY = "die-manual-shake";
export const MANUAL_SHAKE_VERSION = 1;
export const MAX_IDS_PER_KIND = 2048;
export const MAX_RECORD_BYTES = 256 * 1024;
const MAX_ID_LENGTH = 512;
const MAX_SESSION_ID_LENGTH = 512;

export type ShakeRecord = {
  version: 1;
  sessionId: string;
  assistantEntryIds: string[];
  toolResultEntryIds: string[];
  shakenAt: number;
};
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}
export function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function uniqueStrings(value: unknown, limit: number): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(validId) && new Set(value).size === value.length;
}
export function isShakeRecord(value: unknown): value is ShakeRecord {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (
    JSON.stringify(keys) !==
    JSON.stringify(["assistantEntryIds", "sessionId", "shakenAt", "toolResultEntryIds", "version"])
  )
    return false;
  return (
    value.version === MANUAL_SHAKE_VERSION &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    value.sessionId.length <= MAX_SESSION_ID_LENGTH &&
    typeof value.shakenAt === "number" &&
    Number.isFinite(value.shakenAt) &&
    value.shakenAt >= 0 &&
    uniqueStrings(value.assistantEntryIds, MAX_IDS_PER_KIND) &&
    uniqueStrings(value.toolResultEntryIds, MAX_IDS_PER_KIND) &&
    serializedBytes(value) <= MAX_RECORD_BYTES
  );
}

export class InvalidShakeRecordError extends Error {
  constructor() {
    super(
      "The latest manual-shake checkpoint is malformed or uses an unsupported version. Refusing to expose unprojected context; branch before that checkpoint or repair/remove the invalid JSONL entry.",
    );
    this.name = "InvalidShakeRecordError";
  }
}
