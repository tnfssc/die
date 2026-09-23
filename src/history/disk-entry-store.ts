import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { FileEntry, SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";

export const DEFAULT_SESSION_CACHE_BYTES = 4 * 1024 * 1024;

const liveSpools = new Set<string>();
process.once("exit", () => {
  for (const path of liveSpools) {
    try {
      unlinkSync(path);
    } catch {}
  }
});

export interface EntryMetadata {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  offset: number;
  length: number;
  messageRole?: string;
  messageProvider?: string;
  messageModel?: string;
  firstKeptEntryId?: string;
  thinkingLevel?: string;
  provider?: string;
  modelId?: string;
  targetId?: string;
  label?: string;
  name?: string;
}

type LocatedEntry = { entry: FileEntry; offset: number; length: number };

/** Read valid JSONL records without keeping the whole file. */
export function scanJsonl(path: string, visit: (record: LocatedEntry, validIndex: number) => void): void {
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let fileOffset = 0;
  let lineOffset = 0;
  let pieces: Buffer[] = [];
  let piecesLength = 0;
  let validIndex = 0;
  const consume = (line: Buffer, offset: number) => {
    if (line.length === 0 || line.toString("utf8").trim().length === 0) return;
    let entry: FileEntry;
    try {
      entry = JSON.parse(line.toString("utf8")) as FileEntry;
    } catch {
      // Match the SDK: malformed lines are ignored.
      return;
    }
    // SDK load ignores JSON null/false/zero as well as malformed lines.
    if (!entry) return;
    visit({ entry, offset, length: line.length }, validIndex++);
  };
  try {
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, fileOffset);
      if (count === 0) break;
      let start = 0;
      for (let i = 0; i < count; i++) {
        if (buffer[i] !== 10) continue;
        const fragment = Buffer.from(buffer.subarray(start, i));
        if (pieces.length === 0) consume(fragment, lineOffset);
        else {
          pieces.push(fragment);
          consume(Buffer.concat(pieces, piecesLength + fragment.length), lineOffset);
          pieces = [];
          piecesLength = 0;
        }
        lineOffset = fileOffset + i + 1;
        start = i + 1;
      }
      if (start < count) {
        const fragment = Buffer.from(buffer.subarray(start, count));
        pieces.push(fragment);
        piecesLength += fragment.length;
      }
      fileOffset += count;
    }
    if (pieces.length) consume(Buffer.concat(pieces, piecesLength), lineOffset);
  } finally {
    closeSync(fd);
  }
}

function tempPath(target: string, purpose: string): string {
  return `${target}.${purpose}-${process.pid}-${randomUUID()}`;
}

function writeAll(fd: number, bytes: Buffer): void {
  let written = 0;
  while (written < bytes.length) {
    const count = writeSync(fd, bytes, written, bytes.length - written);
    if (count <= 0) throw new Error("Failed to write session file");
    written += count;
  }
}

function writeLine(fd: number, entry: FileEntry): { offset: number; length: number; bytes: Buffer } {
  const offset = fstatSync(fd).size;
  const bytes = Buffer.from(`${JSON.stringify(entry)}\n`);
  writeAll(fd, bytes);
  return { offset, length: bytes.length - 1, bytes };
}

function atomicReplace(target: string, write: (fd: number) => void, exclusive = false): void {
  // Preserve symlink aliases when rewriting an existing journal. Exclusive
  // creation deliberately uses the requested path and must reject any alias.
  if (!exclusive) {
    try {
      target = realpathSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  const tmp = tempPath(target, "rewrite");
  const fd = openSync(tmp, "wx", 0o600);
  try {
    write(fd);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {}
    throw error;
  }
  closeSync(fd);
  try {
    if (exclusive) {
      linkSync(tmp, target);
      unlinkSync(tmp);
    } else renameSync(tmp, target);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw error;
  }
}

/** Upgrade old files in two streaming passes. Do not build a whole-file graph. */
export function migrateSessionFile(path: string, version: number): void {
  if (version >= 3) return;
  const ids: Array<string | undefined> = [];
  if (version < 2) {
    const assigned = new Set<string>();
    scanJsonl(path, ({ entry }, index) => {
      if (entry.type === "session") return;
      let id: string;
      do {
        id = randomUUID().slice(0, 8);
      } while (assigned.has(id));
      assigned.add(id);
      ids[index] = id;
    });
  }
  atomicReplace(path, (fd) => {
    let previous: string | null = null;
    scanJsonl(path, ({ entry }, index) => {
      const mutable = entry as FileEntry & Record<string, any>;
      if (mutable.type === "session") mutable.version = 3;
      else {
        if (version < 2) {
          mutable.id = ids[index]!;
          mutable.parentId = previous;
          previous = mutable.id;
          if (mutable.type === "compaction" && typeof mutable.firstKeptEntryIndex === "number") {
            mutable.firstKeptEntryId = ids[mutable.firstKeptEntryIndex]!;
            delete mutable.firstKeptEntryIndex;
          }
        }
        if (mutable.type === "message" && (mutable as any).message?.role === "hookMessage")
          (mutable as any).message.role = "custom";
      }
      writeLine(fd, mutable);
    });
  });
}

function metadata(entry: SessionEntry, offset: number, length: number): EntryMetadata {
  const value = entry as SessionEntry & Record<string, any>;
  const meta: EntryMetadata = {
    type: entry.type,
    id: entry.id,
    parentId: entry.parentId,
    timestamp: entry.timestamp,
    offset,
    length,
  };
  if (entry.type === "message") {
    meta.messageRole = value.message?.role;
    meta.messageProvider = value.message?.provider;
    meta.messageModel = value.message?.model;
  } else if (entry.type === "compaction") meta.firstKeptEntryId = value.firstKeptEntryId;
  else if (entry.type === "thinking_level_change") meta.thinkingLevel = value.thinkingLevel;
  else if (entry.type === "model_change") {
    meta.provider = value.provider;
    meta.modelId = value.modelId;
  } else if (entry.type === "label") {
    meta.targetId = value.targetId;
    meta.label = value.label;
  } else if (entry.type === "session_info") meta.name = value.name;
  return meta;
}

export function metadataSkeleton(meta: EntryMetadata): SessionEntry {
  return { type: meta.type, id: meta.id, parentId: meta.parentId, timestamp: meta.timestamp } as SessionEntry;
}

export class DiskEntryStore {
  readonly targetPath: string;
  readonly budgetBytes: number;
  header!: SessionHeader;
  entries: EntryMetadata[] = [];
  byId = new Map<string, EntryMetadata>();
  flushed: boolean;
  private activePath: string;
  private spoolPath?: string;
  // Cache serialized bytes, not parsed object graphs: the data budget is exact
  // even when JSON expands into many small JS objects. Parsed entries belong
  // only to callers and are never retained by the store.
  private cache = new Map<string, Buffer>();
  private cacheBytes = 0;
  private hasAssistant = false;

  private constructor(targetPath: string, budgetBytes: number, flushed: boolean, activePath: string) {
    this.targetPath = resolve(targetPath);
    this.budgetBytes = budgetBytes;
    this.flushed = flushed;
    this.activePath = activePath;
  }

  static open(path: string, budgetBytes = DEFAULT_SESSION_CACHE_BYTES): DiskEntryStore {
    const target = resolve(path);
    const store = new DiskEntryStore(target, budgetBytes, true, target);
    store.rescan();
    // Native persistent open repairs an unterminated tail only after validating
    // the session. This is never used by cross-session read-only retrieval.
    const fd = openSync(target, "r");
    let needsNewline = false;
    try {
      const size = fstatSync(fd).size;
      if (size > 0) {
        const last = Buffer.allocUnsafe(1);
        readSync(fd, last, 0, 1, size - 1);
        needsNewline = last[0] !== 10;
      }
    } finally {
      closeSync(fd);
    }
    if (needsNewline) {
      const appendFd = openSync(target, "a");
      try {
        writeAll(appendFd, Buffer.from("\n"));
      } finally {
        closeSync(appendFd);
      }
    }
    return store;
  }

  static pending(path: string, header: SessionHeader, budgetBytes = DEFAULT_SESSION_CACHE_BYTES): DiskEntryStore {
    const target = resolve(path);
    mkdirSync(dirname(target), { recursive: true });
    const spool = tempPath(target, "pending");
    const fd = openSync(spool, "wx", 0o600);
    try {
      writeLine(fd, header);
      fsyncSync(fd);
    } catch (error) {
      try {
        unlinkSync(spool);
      } catch {}
      throw error;
    } finally {
      closeSync(fd);
    }
    const store = new DiskEntryStore(target, budgetBytes, false, spool);
    store.spoolPath = spool;
    liveSpools.add(spool);
    store.header = header;
    return store;
  }

  static published(
    path: string,
    header: SessionHeader,
    budgetBytes = DEFAULT_SESSION_CACHE_BYTES,
    exclusive = false,
  ): DiskEntryStore {
    const target = resolve(path);
    atomicReplace(
      target,
      (fd) => {
        writeLine(fd, header);
      },
      exclusive,
    );
    return DiskEntryStore.open(target, budgetBytes);
  }

  static fromEntries(
    path: string,
    header: SessionHeader,
    entries: Iterable<SessionEntry>,
    flushed: boolean,
    budgetBytes = DEFAULT_SESSION_CACHE_BYTES,
  ): DiskEntryStore {
    if (!flushed) {
      const store = DiskEntryStore.pending(path, header, budgetBytes);
      try {
        for (const entry of entries) store.append(entry);
        return store;
      } catch (error) {
        store.dispose();
        throw error;
      }
    }
    const target = resolve(path);
    atomicReplace(target, (fd) => {
      writeLine(fd, header);
      for (const entry of entries) writeLine(fd, entry);
    });
    return DiskEntryStore.open(target, budgetBytes);
  }

  dispose(): void {
    if (this.spoolPath) {
      try {
        unlinkSync(this.spoolPath);
      } catch {}
      liveSpools.delete(this.spoolPath);
      this.spoolPath = undefined;
    }
    this.cache.clear();
    this.cacheBytes = 0;
  }

  append(entry: SessionEntry): void {
    const fd = openSync(this.activePath, "a+");
    let location: { offset: number; length: number; bytes: Buffer };
    let size: number;
    try {
      size = fstatSync(fd).size;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
    try {
      if (size > 0) {
        const last = Buffer.allocUnsafe(1);
        readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 10) writeAll(fd, Buffer.from("\n"));
      }
      location = writeLine(fd, entry);
    } catch (error) {
      // Single-writer journal: a failed partial record must not corrupt the
      // next append or destroy the previously valid unterminated tail.
      try {
        ftruncateSync(fd, size);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Session append and rollback failed");
      }
      throw error;
    } finally {
      closeSync(fd);
    }
    const meta = metadata(entry, location.offset, location.length);
    if (!this.flushed && (this.hasAssistant || meta.messageRole === "assistant")) {
      try {
        this.publish();
      } catch (error) {
        // Publication is part of the first-assistant append transaction. Keep
        // the pending journal and its in-memory indexes at their prior state so
        // the manager can safely leave its leaf unchanged and retry later.
        let rollbackFd: number | undefined;
        try {
          rollbackFd = openSync(this.activePath, "r+");
          ftruncateSync(rollbackFd, size);
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Session publication and rollback failed");
        } finally {
          if (rollbackFd !== undefined) closeSync(rollbackFd);
        }
        throw error;
      }
    }
    this.entries.push(meta);
    this.byId.set(meta.id, meta);
    this.remember(location.bytes, meta);
    this.hasAssistant ||= meta.messageRole === "assistant";
  }

  private publish(): void {
    if (!this.spoolPath) return;
    const spool = this.spoolPath;
    linkSync(spool, this.targetPath);
    this.spoolPath = undefined;
    this.activePath = this.targetPath;
    this.flushed = true;
    try {
      unlinkSync(spool);
      liveSpools.delete(spool);
    } catch {
      // Publication succeeded; a failed redundant-link cleanup must not turn
      // the persisted session into a failed append. Retry cleanup on exit.
    }
  }

  materialize(metaOrId: EntryMetadata | string): SessionEntry {
    const meta = typeof metaOrId === "string" ? this.byId.get(metaOrId) : metaOrId;
    if (!meta) throw new Error(`Entry ${String(metaOrId)} not found`);
    const cacheKey = this.cacheKey(meta);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return JSON.parse(cached.toString("utf8")) as SessionEntry;
    }
    const fd = openSync(this.activePath, "r");
    const bytes = Buffer.allocUnsafe(meta.length);
    try {
      let read = 0;
      while (read < bytes.length) {
        const count = readSync(fd, bytes, read, bytes.length - read, meta.offset + read);
        if (count === 0) throw new Error(`Unexpected end of session file: ${this.activePath}`);
        read += count;
      }
    } finally {
      closeSync(fd);
    }
    const entry = JSON.parse(bytes.toString("utf8")) as SessionEntry;
    this.remember(bytes, meta);
    return entry;
  }

  materializeAll(): SessionEntry[] {
    return this.entries.map((entry) => this.materialize(entry));
  }

  private rescan(): void {
    this.entries = [];
    this.byId.clear();
    this.cache.clear();
    this.cacheBytes = 0;
    let header: SessionHeader | undefined;
    this.hasAssistant = false;
    scanJsonl(this.activePath, ({ entry, offset, length }, index) => {
      if (index === 0 && (entry.type !== "session" || typeof entry.id !== "string"))
        throw new Error("Session file has no valid initial header: " + this.targetPath);
      if (entry.type === "session") {
        header ??= entry as SessionHeader;
        return;
      }
      const meta = metadata(entry as SessionEntry, offset, length);
      this.entries.push(meta);
      this.byId.set(meta.id, meta);
      this.hasAssistant ||= meta.messageRole === "assistant";
    });
    if (!header) throw new Error(`Session file has no header: ${this.targetPath}`);
    this.header = header;
  }

  private cacheKey(meta: EntryMetadata): string {
    return meta.offset + ":" + meta.length;
  }

  private remember(bytes: Buffer, meta: EntryMetadata): void {
    if (bytes.length > this.budgetBytes) return;
    const key = this.cacheKey(meta);
    const old = this.cache.get(key);
    if (old) this.cacheBytes -= old.length;
    this.cache.delete(key);
    this.cache.set(key, bytes);
    this.cacheBytes += bytes.length;
    while (this.cacheBytes > this.budgetBytes) {
      const oldest = this.cache.entries().next().value;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      this.cacheBytes -= oldest[1].length;
    }
  }
}

/** Read the first parsed record without loading or changing the journal. */
export function readSessionFileHeader(path: string): SessionHeader | undefined {
  const done = Symbol("session-header-found");
  let header: SessionHeader | undefined;
  try {
    scanJsonl(path, ({ entry }) => {
      if (entry.type === "session" && typeof entry.id === "string") header = entry;
      throw done;
    });
  } catch (error) {
    if (error !== done) throw error;
  }
  return header;
}

export function sessionFileVersion(path: string): number | undefined {
  const header = readSessionFileHeader(path);
  if (!header) throw new Error("Session file has no valid initial header: " + path);
  return header.version ?? 1;
}
