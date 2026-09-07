import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { InvalidShakeRecordError, isShakeRecord, MANUAL_SHAKE_ENTRY } from "../tasks/manual-shake";
import type { HistoryProvenance, HistoryReadResult, HistorySearchMatch, HistorySearchResult } from "./types";

const MAX_QUERY_CHARS = 500;
const MAX_SEARCH_RESULTS = 50;
const DEFAULT_SEARCH_RESULTS = 20;
const MAX_EXCERPT_CHARS = 600;
const DEFAULT_EXCERPT_CHARS = 240;
const MAX_READ_CHARS = 16_000;
const DEFAULT_READ_CHARS = 8_000;
const MAX_SCAN_ENTRIES = 20_000;
const MAX_SESSION_PATH_CHARS = 4_096;
const MAX_CURSOR_CHARS = 16_000;
const MAX_SESSION_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SESSION_ENTRIES = 100_000;
const MAX_SESSION_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_ACTIVE_BRANCH_ENTRIES = 100_000;
const MAX_EXCLUDED_ENTRY_IDS = 100_000;
const MAX_INDEXED_PARTS = 100_000;
const MAX_INDEXED_TEXT_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_PART_BYTES = 4 * 1024 * 1024;
const REF_PREFIX = "die-history-v1";
const CURSOR_PREFIX = "dhc1.";

type Manager = Pick<SessionManager, "getSessionId" | "getSessionFile" | "getCwd" | "getLeafId" | "getBranch">;
type Context = { sessionManager: Manager };
type ScopeInput = { sessionFile?: string; allowCrossSession?: boolean };
type TextItem = { text: string; provenance: HistoryProvenance; rank: number };
type Cursor = { kind: "search" | "read"; sessionId: string; leafId: string | null; offset: number; key: string };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value as number;
}
function cursorEncode(value: Cursor): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify(value)).toString("base64url");
}
function cursorDecode(value: unknown, kind: Cursor["kind"]): Cursor | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length > MAX_CURSOR_CHARS || !value.startsWith(CURSOR_PREFIX))
    throw new Error("Invalid history cursor");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid history cursor");
  }
  if (
    !record(decoded) ||
    decoded.kind !== kind ||
    typeof decoded.sessionId !== "string" ||
    !(decoded.leafId === null || typeof decoded.leafId === "string") ||
    !Number.isSafeInteger(decoded.offset) ||
    (decoded.offset as number) < 0 ||
    typeof decoded.key !== "string"
  )
    throw new Error("Invalid history cursor");
  return decoded as unknown as Cursor;
}
/** Read a session without the SDK's persistent open path, which may repair or migrate files. */
async function openReadonlySession(path: string): Promise<Manager> {
  const sessionFile = resolve(path);
  // O_NONBLOCK prevents a special file such as a FIFO from hanging before fstat.
  // The descriptor remains strictly read-only; only regular files proceed to reads.
  const handle = await open(sessionFile, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0) throw new Error("Cross-session history requires a non-empty regular file");
    if (stat.size > MAX_SESSION_FILE_BYTES)
      throw new Error(`Cross-session file exceeds the ${MAX_SESSION_FILE_BYTES}-byte history limit`);
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const parsed: Record<string, unknown>[] = [];
    for (const line of bytes.subarray(0, offset).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > MAX_SESSION_ENTRY_BYTES)
        throw new Error(`Cross-session entry exceeds the ${MAX_SESSION_ENTRY_BYTES}-byte history limit`);
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error("Cross-session file contains invalid JSONL");
      }
      if (!record(value)) throw new Error("Cross-session file contains an invalid entry");
      parsed.push(value);
      if (parsed.length > MAX_SESSION_ENTRIES)
        throw new Error(`Cross-session file exceeds the ${MAX_SESSION_ENTRIES}-entry history limit`);
    }
    const header = parsed[0];
    if (
      header?.type !== "session" ||
      typeof header.id !== "string" ||
      header.id.length > 128 ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(header.id)
    )
      throw new Error("Cross-session file is not a valid session");
    if (!Number.isInteger(header.version) || (header.version as number) < 2)
      throw new Error("Cross-session history requires a version 2 or newer session; migrate a copy first");
    if (typeof header.cwd === "string" && header.cwd.length > MAX_SESSION_PATH_CHARS)
      throw new Error("Cross-session cwd exceeds the history limit");
    const byId = new Map<string, SessionEntry>();
    let leafId: string | null = null;
    for (const value of parsed.slice(1)) {
      if (
        typeof value.id !== "string" ||
        !value.id ||
        value.id.length > 128 ||
        value.id.includes(":") ||
        !(
          value.parentId === null ||
          (typeof value.parentId === "string" && value.parentId.length > 0 && value.parentId.length <= 128)
        ) ||
        byId.has(value.id) ||
        typeof value.timestamp !== "string" ||
        value.timestamp.length > 128
      )
        throw new Error("Cross-session file contains an invalid or duplicate entry id");
      byId.set(value.id, value as unknown as SessionEntry);
      leafId = value.id;
    }
    const getBranch = (fromId?: string): SessionEntry[] => {
      const result: SessionEntry[] = [];
      const seen = new Set<string>();
      let id: string | null | undefined = fromId ?? leafId;
      while (id) {
        if (seen.has(id)) throw new Error("Cross-session file contains a cyclic branch");
        seen.add(id);
        const entry = byId.get(id);
        if (!entry) throw new Error("Cross-session file contains a broken branch");
        result.push(entry);
        id = entry.parentId;
      }
      return result.reverse();
    };
    return {
      getSessionId: () => header.id as string,
      getSessionFile: () => sessionFile,
      getCwd: () => (typeof header.cwd === "string" ? header.cwd : ""),
      getLeafId: () => leafId,
      getBranch,
    };
  } finally {
    await handle.close();
  }
}

function boundedBranch(manager: Manager, fromId?: string): SessionEntry[] {
  const branch = manager.getBranch(fromId);
  if (branch.length > MAX_ACTIVE_BRANCH_ENTRIES)
    throw new Error(`Active history branch exceeds the ${MAX_ACTIVE_BRANCH_ENTRIES}-entry limit`);
  return branch;
}

function retrievalExcludedResults(entries: readonly SessionEntry[]): Set<string> {
  const excluded = new Set<string>();
  let work = 0;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== MANUAL_SHAKE_ENTRY) continue;
    // Validate before using any subset: truncating exclusion data could leak a
    // result the transcript explicitly removed.
    if (!isShakeRecord(entry.data)) throw new InvalidShakeRecordError();
    work += entry.data.toolResultEntryIds.length;
    if (work > MAX_EXCLUDED_ENTRY_IDS)
      throw new Error(`History exclusions exceed the ${MAX_EXCLUDED_ENTRY_IDS}-id limit`);
    for (const id of entry.data.toolResultEntryIds) excluded.add(id);
  }
  return excluded;
}

function textParts(content: unknown): Array<{ part: number; text: string }> {
  if (typeof content === "string") return [{ part: 0, text: content }];
  if (!Array.isArray(content)) return [];
  if (content.length > MAX_INDEXED_PARTS)
    throw new Error(`History message exceeds the ${MAX_INDEXED_PARTS}-part limit`);
  const result: Array<{ part: number; text: string }> = [];
  for (let index = 0; index < content.length; index++) {
    const part = content[index];
    if (record(part) && part.type === "text" && typeof part.text === "string")
      result.push({ part: index, text: part.text });
  }
  return result;
}

/** Lowercase while retaining the source UTF-16 offset for each folded code unit. */
function foldWithOffsets(text: string): { text: string; offsets: number[] } {
  // Fold the complete string to retain context-sensitive mappings (for
  // example, Greek final sigma), while scalar lengths map expansion back to
  // the corresponding original UTF-16 coordinate.
  const folded = text.toLowerCase();
  const offsets: number[] = [];
  let sourceOffset = 0;
  for (const scalar of text) {
    const foldedLength = scalar.toLowerCase().length;
    for (let index = 0; index < foldedLength; index++) offsets.push(sourceOffset);
    sourceOffset += scalar.length;
  }
  return { text: folded, offsets };
}
function ref(sessionId: string, entryId: string, part: number): string {
  return `${REF_PREFIX}:${sessionId}:${entryId}:${part}`;
}
function parseRef(value: unknown): { sessionId: string; entryId: string; part: number } {
  if (typeof value !== "string") throw new Error("History ref must be a string");
  if (value.length > 300) throw new Error("Invalid history ref");
  const match = /^die-history-v1:([^:]{1,128}):([^:]{1,128}):(\d+)$/.exec(value);
  if (!match?.[1] || !match[2]) throw new Error("Invalid history ref");
  const part = Number(match[3]);
  if (!Number.isSafeInteger(part)) throw new Error("Invalid history ref");
  return { sessionId: match[1], entryId: match[2], part };
}
function excerpt(text: string, match: number, limit: number): string {
  if (text.length <= limit) return text;
  const start = Math.max(0, Math.min(match - Math.floor(limit / 3), text.length - limit));
  return (start ? "…" : "") + text.slice(start, start + limit) + (start + limit < text.length ? "…" : "");
}

export class HistoryService {
  async handle(method: string, params: unknown, ctx: Context): Promise<unknown> {
    if (method === "history.search") return await this.search(params, ctx);
    if (method === "history.read") return await this.read(params, ctx);
    throw new Error(`Unknown history method: ${method}`);
  }

  async search(params: unknown, ctx: Context): Promise<HistorySearchResult> {
    if (!record(params)) throw new Error("History search parameters must be an object");
    const query = params.query;
    if (typeof query !== "string" || !query.trim() || query.length > MAX_QUERY_CHARS)
      throw new Error(`History query must contain 1 to ${MAX_QUERY_CHARS} characters`);
    const limit = integer(params.limit, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS, "limit");
    const excerptChars = integer(params.excerptChars, DEFAULT_EXCERPT_CHARS, 40, MAX_EXCERPT_CHARS, "excerptChars");
    const { manager, scope } = await this.#scope(params, ctx);
    const key = JSON.stringify({ query, excerptChars, scope, file: manager.getSessionFile() ?? null });
    const cursor = cursorDecode(params.cursor, "search");
    this.#validateCursor(cursor, manager, key);
    const snapshotLeaf = cursor?.leafId ?? manager.getLeafId();
    const items = this.#items(manager, scope, snapshotLeaf);
    const needle = query.toLowerCase();
    const matches: HistorySearchMatch[] = [];
    for (const item of items.values) {
      const folded = foldWithOffsets(item.text);
      const foldedAt = folded.text.indexOf(needle);
      const at = foldedAt < 0 ? -1 : folded.offsets[foldedAt];
      if (at >= 0)
        matches.push({
          ref: ref(item.provenance.sessionId, item.provenance.entryId, item.provenance.part),
          excerpt: excerpt(item.text, at, excerptChars),
          matchOffset: at,
          textLength: item.text.length,
          provenance: item.provenance,
        });
    }
    // Direct dialogue precedes execution output, which helps original evidence
    // outrank tool-produced summaries and retrieval echoes.
    matches.sort((a, b) => {
      const ar = items.rankByRef.get(a.ref) ?? 9;
      const br = items.rankByRef.get(b.ref) ?? 9;
      return ar - br || b.provenance.timestamp.localeCompare(a.provenance.timestamp) || a.ref.localeCompare(b.ref);
    });
    const offset = cursor?.offset ?? 0;
    const page = matches.slice(offset, offset + limit);
    const next =
      offset + page.length < matches.length
        ? cursorEncode({
            kind: "search",
            sessionId: manager.getSessionId(),
            leafId: snapshotLeaf,
            offset: offset + page.length,
            key,
          })
        : undefined;
    return {
      matches: page,
      ...(next ? { nextCursor: next } : {}),
      scannedEntries: items.scannedEntries,
      scanLimited: items.scanLimited,
    };
  }

  async read(params: unknown, ctx: Context): Promise<HistoryReadResult> {
    if (!record(params)) throw new Error("History read parameters must be an object");
    const parsed = parseRef(params.ref);
    const maxChars = integer(params.maxChars, DEFAULT_READ_CHARS, 1, MAX_READ_CHARS, "maxChars");
    const { manager, scope } = await this.#scope(params, ctx);
    if (parsed.sessionId !== manager.getSessionId())
      throw new Error("History ref does not belong to the selected session");
    const key = String(params.ref);
    const cursor = cursorDecode(params.cursor, "read");
    this.#validateCursor(cursor, manager, key);
    const snapshotLeaf = cursor?.leafId ?? manager.getLeafId();
    const items = this.#items(manager, scope, snapshotLeaf);
    const item = items.values.find(
      (candidate) => candidate.provenance.entryId === parsed.entryId && candidate.provenance.part === parsed.part,
    );
    if (!item)
      throw new Error("History ref is unavailable on the selected active branch or is excluded from retrieval");
    const start = cursor?.offset ?? 0;
    if (start > item.text.length) throw new Error("History cursor is past the end of the referenced text");
    const end = Math.min(item.text.length, start + maxChars);
    const next =
      end < item.text.length
        ? cursorEncode({ kind: "read", sessionId: manager.getSessionId(), leafId: snapshotLeaf, offset: end, key })
        : undefined;
    return {
      ref: key,
      text: item.text.slice(start, end),
      range: { start, end, total: item.text.length },
      ...(next ? { nextCursor: next } : {}),
      provenance: item.provenance,
    };
  }

  async #scope(
    params: Record<string, unknown>,
    ctx: Context,
  ): Promise<{ manager: Manager; scope: HistoryProvenance["scope"] }> {
    const input = params as ScopeInput;
    if (input.sessionFile === undefined) {
      if (input.allowCrossSession === true) throw new Error("allowCrossSession requires an explicit sessionFile");
      return { manager: ctx.sessionManager, scope: "active-session-branch" };
    }
    if (
      typeof input.sessionFile !== "string" ||
      !input.sessionFile ||
      input.sessionFile.length > MAX_SESSION_PATH_CHARS
    )
      throw new Error(`sessionFile must be a non-empty string of at most ${MAX_SESSION_PATH_CHARS} characters`);
    if (input.allowCrossSession !== true) throw new Error("Cross-session history requires allowCrossSession: true");
    return { manager: await openReadonlySession(input.sessionFile), scope: "cross-session-branch" };
  }

  #validateCursor(cursor: Cursor | undefined, manager: Manager, key: string): void {
    if (!cursor) return;
    if (cursor.sessionId !== manager.getSessionId() || cursor.key !== key)
      throw new Error("History cursor does not match this query, reference, session, or active branch");
    const activeIds = new Set(boundedBranch(manager).map((entry) => entry.id));
    if (cursor.leafId !== null && !activeIds.has(cursor.leafId))
      throw new Error("History cursor does not match this query, reference, session, or active branch");
  }

  #items(
    manager: Manager,
    scope: HistoryProvenance["scope"],
    leafId: string | null = manager.getLeafId(),
  ): { values: TextItem[]; rankByRef: Map<string, number>; scannedEntries: number; scanLimited: boolean } {
    const branch = leafId === null ? [] : boundedBranch(manager, leafId);
    const scanLimited = branch.length > MAX_SCAN_ENTRIES;
    const selected = scanLimited ? branch.slice(-MAX_SCAN_ENTRIES) : branch;
    // Cursor data remains pinned to its snapshot, but exclusion policy is live.
    const excludedResults = retrievalExcludedResults(boundedBranch(manager));
    const values: TextItem[] = [];
    let indexedParts = 0;
    let indexedBytes = 0;
    for (const entry of selected) {
      if (entry.type !== "message" || excludedResults.has(entry.id)) continue;
      const message = entry.message as unknown;
      if (!record(message) || typeof message.role !== "string") continue;
      let parts: Array<{ part: number; text: string }> = [];
      let rank = 9;
      if (message.role === "user") {
        parts = textParts(message.content);
        rank = 0;
      } else if (message.role === "assistant") {
        parts = textParts(message.content);
        rank = 1;
      } else if (message.role === "toolResult") {
        parts = textParts(message.content);
        rank = 3;
      } else if (message.role === "bashExecution" && message.excludeFromContext !== true) {
        parts = [
          typeof message.command === "string" ? { part: 0, text: message.command } : undefined,
          typeof message.output === "string" ? { part: 1, text: message.output } : undefined,
        ].filter((part): part is { part: number; text: string } => !!part);
        rank = 2;
      } else continue;
      indexedParts += Array.isArray(message.content) ? message.content.length : parts.length;
      if (indexedParts > MAX_INDEXED_PARTS) throw new Error(`History scan exceeds the ${MAX_INDEXED_PARTS}-part limit`);
      for (const part of parts) {
        const bytes = Buffer.byteLength(part.text);
        if (bytes > MAX_TEXT_PART_BYTES)
          throw new Error(`History text part exceeds the ${MAX_TEXT_PART_BYTES}-byte limit`);
        indexedBytes += bytes;
        if (indexedBytes > MAX_INDEXED_TEXT_BYTES)
          throw new Error(`History scan exceeds the ${MAX_INDEXED_TEXT_BYTES}-byte text limit`);
        const provenance: HistoryProvenance = {
          source: "original-transcript",
          scope,
          sessionId: manager.getSessionId(),
          ...(manager.getSessionFile() ? { sessionFile: manager.getSessionFile() } : {}),
          cwd: manager.getCwd(),
          branchLeafId: leafId,
          entryId: entry.id,
          timestamp: entry.timestamp,
          role: message.role as HistoryProvenance["role"],
          part: part.part,
        };
        values.push({ text: part.text, provenance, rank });
      }
    }
    const rankByRef = new Map(
      values.map((item) => [ref(item.provenance.sessionId, item.provenance.entryId, item.provenance.part), item.rank]),
    );
    return { values, rankByRef, scannedEntries: selected.length, scanLimited };
  }
}
