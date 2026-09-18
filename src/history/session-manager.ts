import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionContext, SessionEntry, SessionHeader, SessionTreeNode } from "@earendil-works/pi-coding-agent";
import {
  CURRENT_SESSION_VERSION,
  SessionManager,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SESSION_CACHE_BYTES,
  DiskEntryStore,
  type EntryMetadata,
  metadataSkeleton,
  migrateSessionFile,
  readSessionFileHeader,
  scanJsonl,
  sessionFileVersion,
} from "./disk-entry-store";

interface ManagerInternals {
  cwd: string;
  sessionDir: string;
  sessionId: string;
  sessionFile?: string;
  persist: boolean;
  flushed: boolean;
  fileEntries: Array<SessionHeader | SessionEntry>;
  byId: Map<string, SessionEntry>;
  labelsById: Map<string, string>;
  labelTimestampsById: Map<string, string>;
  leafId: string | null;
  _appendEntry(entry: SessionEntry): void;
  _rewriteFile(): void;
}

interface ManagerState {
  store: DiskEntryStore;
  skeletonEntries?: Array<SessionHeader | SessionEntry>;
}
const states = new WeakMap<SessionManager, ManagerState>();
// SDK teardown may still read a live manager: finalize only unreachable owners.
const abandonedManagers = new FinalizationRegistry<DiskEntryStore>((store) => store.dispose());

/** Release an owned temporary manager once no caller will read it again. */
export function disposeDiskBackedSessionManager(manager: SessionManager): void {
  abandonedManagers.unregister(manager);
  states.get(manager)?.store.dispose();
  states.delete(manager);
}

function withTemporaryManager(
  manager: SessionManager,
  operation: (manager: SessionManager) => SessionManager,
): SessionManager {
  try {
    return operation(manager);
  } catch (error) {
    disposeDiskBackedSessionManager(manager);
    throw error;
  }
}
let installed = false;

/** Match Pi's supported POSIX path input forms without a private package import. */
function resolveSessionPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path.startsWith("file://") ? fileURLToPath(path) : path);
}

function internals(manager: SessionManager): ManagerInternals {
  return manager as unknown as ManagerInternals;
}

function syncIndexes(manager: SessionManager, store: DiskEntryStore): void {
  const target = internals(manager);
  const skeletons = store.entries.map(metadataSkeleton);
  target.fileEntries = [store.header, ...skeletons];
  const owned = states.get(manager);
  if (owned) owned.skeletonEntries = target.fileEntries;
  target.byId = new Map(skeletons.map((entry) => [entry.id, entry]));
  target.labelsById = new Map();
  target.labelTimestampsById = new Map();
  for (const meta of store.entries) {
    if (meta.type !== "label" || !meta.targetId) continue;
    if (meta.label) {
      target.labelsById.set(meta.targetId, meta.label);
      target.labelTimestampsById.set(meta.targetId, meta.timestamp);
    } else {
      target.labelsById.delete(meta.targetId);
      target.labelTimestampsById.delete(meta.targetId);
    }
  }
  target.sessionId = store.header.id;
  target.sessionFile = store.targetPath;
  target.leafId = store.entries.at(-1)?.id ?? null;
  target.flushed = store.flushed;
}

function adopt(manager: SessionManager, store: DiskEntryStore): SessionManager {
  states.get(manager)?.store.dispose();
  abandonedManagers.unregister(manager);
  states.set(manager, { store });
  abandonedManagers.register(manager, store, manager);
  syncIndexes(manager, store);
  return manager;
}

function state(manager: SessionManager): ManagerState | undefined {
  return states.get(manager);
}

/** A failed reset/switch/branch must leave the old journal usable. */
function recoverStateOnFailure<T>(manager: SessionManager, operation: () => T): T {
  const previous = state(manager);
  const previousLeaf = internals(manager).leafId;
  try {
    return operation();
  } catch (error) {
    if (previous) {
      states.set(manager, previous);
      syncIndexes(manager, previous.store);
      internals(manager).leafId = previousLeaf;
    }
    throw error;
  }
}

function pathMetadata(store: DiskEntryStore, leafId: string | null | undefined): EntryMetadata[] {
  if (!leafId) return [];
  let current = store.byId.get(leafId);
  if (!current) return [];
  const path: EntryMetadata[] = [];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    path.push(current);
    seen.add(current.id);
    current = current.parentId ? store.byId.get(current.parentId) : undefined;
  }
  path.reverse();
  return path;
}

function contextMetadata(path: EntryMetadata[]): EntryMetadata[] {
  let compaction: EntryMetadata | undefined;
  for (const meta of path) if (meta.type === "compaction") compaction = meta;
  if (!compaction) return path;
  const at = path.indexOf(compaction);
  const selected: EntryMetadata[] = [compaction];
  let keep = false;
  for (let i = 0; i < at; i++) {
    if (path[i].id === compaction.firstKeptEntryId) keep = true;
    if (keep) selected.push(path[i]);
  }
  selected.push(...path.slice(at + 1));
  return selected;
}

function contextSettings(path: EntryMetadata[]): Pick<SessionContext, "thinkingLevel" | "model"> {
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  for (const meta of path) {
    if (meta.type === "thinking_level_change") thinkingLevel = meta.thinkingLevel!;
    else if (meta.type === "model_change") model = { provider: meta.provider!, modelId: meta.modelId! };
    else if (meta.type === "message" && meta.messageRole === "assistant")
      model = { provider: meta.messageProvider!, modelId: meta.messageModel! };
  }
  return { thinkingLevel, model };
}

function openStore(path: string): DiskEntryStore {
  const version = sessionFileVersion(path);
  if (version !== undefined && version < CURRENT_SESSION_VERSION) migrateSessionFile(path, version);
  return DiskEntryStore.open(path, DEFAULT_SESSION_CACHE_BYTES);
}

/**
 * Install the 0.85.1-compatible disk-backed implementation on the SDK class.
 * Call this before importing/invoking the SDK CLI main function. In-memory managers
 * are deliberately untouched.
 */
export function installDiskBackedSessionManager(): void {
  if (installed) return;
  installed = true;

  const klass: any = SessionManager;
  const prototype: any = SessionManager.prototype;
  const original = {
    create: klass.create,
    inMemory: klass.inMemory,
    newSession: prototype.newSession,
    appendEntry: prototype._appendEntry,
    createBranchedSession: prototype.createBranchedSession,
    setSessionFile: prototype.setSessionFile,
    getEntry: prototype.getEntry,
    getLeafEntry: prototype.getLeafEntry,
    getChildren: prototype.getChildren,
    getEntries: prototype.getEntries,
    getBranch: prototype.getBranch,
    getTree: prototype.getTree,
    buildContextEntries: prototype.buildContextEntries,
    buildSessionContext: prototype.buildSessionContext,
    getHeader: prototype.getHeader,
    getSessionName: prototype.getSessionName,
  };

  prototype._appendEntry = function (this: SessionManager, entry: SessionEntry): void {
    const owned = state(this);
    if (!owned) {
      original.appendEntry.call(this, entry);
      return;
    }
    const previousCount = owned.store.entries.length;
    try {
      owned.store.append(entry);
    } catch (error) {
      // Publication may fail after the complete entry reached the private
      // spool. Preserve the SDK's advanced leaf/index so a retry keeps its tree.
      if (owned.store.entries.length !== previousCount) syncIndexes(this, owned.store);
      throw error;
    }
    const target = internals(this);
    const meta = owned.store.entries.at(-1)!;
    const skeleton = metadataSkeleton(meta);
    target.fileEntries.push(skeleton);
    target.byId.set(meta.id, skeleton);
    target.leafId = meta.id;
    target.flushed = owned.store.flushed;
    if (meta.type === "label" && meta.targetId) {
      if (meta.label) {
        target.labelsById.set(meta.targetId, meta.label);
        target.labelTimestampsById.set(meta.targetId, meta.timestamp);
      } else {
        target.labelsById.delete(meta.targetId);
        target.labelTimestampsById.delete(meta.targetId);
      }
    }
  };

  prototype._rewriteFile = function (this: SessionManager): void {
    const target = internals(this);
    if (!target.persist || !target.sessionFile) return;
    const header = target.fileEntries.find((entry) => entry.type === "session") as SessionHeader | undefined;
    if (!header) return;
    const owned = state(this);
    // Ordinary rewrites see the internal metadata list; branch creation supplies
    // a new full entry array. Never serialize metadata skeletons as originals.
    const entries =
      owned?.skeletonEntries === target.fileEntries
        ? (function* () {
            for (const meta of owned.store.entries) yield owned.store.materialize(meta);
          })()
        : target.fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
    const leafId = target.leafId;
    // Native _rewriteFile always writes, even for a header-only file. Delayed
    // first-assistant publication is handled by callers, not by this method.
    adopt(this, DiskEntryStore.fromEntries(target.sessionFile, header, entries, true));
    target.leafId = leafId;
  };

  prototype.getEntry = function (this: SessionManager, id: string): SessionEntry | undefined {
    const owned = state(this);
    return owned
      ? owned.store.byId.has(id)
        ? owned.store.materialize(id)
        : undefined
      : original.getEntry.call(this, id);
  };
  prototype.getLeafEntry = function (this: SessionManager): SessionEntry | undefined {
    const owned = state(this);
    const leafId = internals(this).leafId;
    return owned ? (leafId ? owned.store.materialize(leafId) : undefined) : original.getLeafEntry.call(this);
  };
  prototype.getChildren = function (this: SessionManager, parentId: string): SessionEntry[] {
    const owned = state(this);
    if (!owned) return original.getChildren.call(this, parentId);
    return Array.from(owned.store.byId.values())
      .filter((meta) => meta.parentId === parentId)
      .map((meta) => owned.store.materialize(meta));
  };
  prototype.getEntries = function (this: SessionManager): SessionEntry[] {
    const owned = state(this);
    return owned ? owned.store.materializeAll() : original.getEntries.call(this);
  };
  prototype.getBranch = function (this: SessionManager, fromId?: string): SessionEntry[] {
    const owned = state(this);
    if (!owned) return original.getBranch.call(this, fromId);
    return pathMetadata(owned.store, fromId ?? internals(this).leafId).map((meta) => owned.store.materialize(meta));
  };
  prototype.buildContextEntries = function (this: SessionManager): SessionEntry[] {
    const owned = state(this);
    if (!owned) return original.buildContextEntries.call(this);
    const path = pathMetadata(owned.store, internals(this).leafId);
    return contextMetadata(path).map((meta) => owned.store.materialize(meta));
  };
  prototype.buildSessionContext = function (this: SessionManager): SessionContext {
    const owned = state(this);
    if (!owned) return original.buildSessionContext.call(this);
    const path = pathMetadata(owned.store, internals(this).leafId);
    const messages = contextMetadata(path).flatMap((meta) =>
      sessionEntryToContextMessages(owned.store.materialize(meta)),
    );
    return { messages, ...contextSettings(path) };
  };
  prototype.getHeader = function (this: SessionManager): SessionHeader | null {
    return state(this)?.store.header ?? original.getHeader.call(this);
  };
  prototype.getSessionName = function (this: SessionManager): string | undefined {
    const owned = state(this);
    if (!owned) return original.getSessionName.call(this);
    for (let i = owned.store.entries.length - 1; i >= 0; i--) {
      const meta = owned.store.entries[i];
      if (meta.type === "session_info") return meta.name?.trim() || undefined;
    }
    return undefined;
  };
  prototype.getTree = function (this: SessionManager): SessionTreeNode[] {
    const owned = state(this);
    if (!owned) return original.getTree.call(this);
    const roots: SessionTreeNode[] = [];
    const nodes = new Map<string, SessionTreeNode>();
    for (const meta of owned.store.entries) {
      const node: SessionTreeNode = {
        entry: owned.store.materialize(meta),
        children: [],
        label: internals(this).labelsById.get(meta.id),
        labelTimestamp: internals(this).labelTimestampsById.get(meta.id),
      };
      nodes.set(meta.id, node);
    }
    for (const meta of owned.store.entries) {
      const node = nodes.get(meta.id)!;
      const parent = meta.parentId && meta.parentId !== meta.id ? nodes.get(meta.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const stack = [...roots];
    const visited = new Set<SessionTreeNode>();
    while (stack.length) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
      stack.push(...node.children);
    }
    return roots;
  };

  prototype.setSessionFile = function (this: SessionManager, path: string): void {
    recoverStateOnFailure(this, () => {
      if (!internals(this).persist) {
        original.setSessionFile.call(this, path);
        return;
      }
      const resolved = resolveSessionPath(path);
      if (existsSync(resolved)) {
        if (statSync(resolved).size === 0) {
          const explicitPath = resolved;
          original.newSession.call(this);
          const header = internals(this).fileEntries[0] as SessionHeader;
          adopt(this, DiskEntryStore.published(explicitPath, header));
        } else adopt(this, openStore(resolved));
      } else {
        original.newSession.call(this);
        internals(this).sessionFile = resolved;
        const header = internals(this).fileEntries[0] as SessionHeader;
        adopt(this, DiskEntryStore.pending(resolved, header));
      }
    });
  };

  prototype.newSession = function (
    this: SessionManager,
    options?: { id?: string; parentSession?: string },
  ): string | undefined {
    return recoverStateOnFailure(this, () => {
      const result = original.newSession.call(this, options);
      if (!internals(this).persist || !result) return result;
      const header = internals(this).fileEntries[0] as SessionHeader;
      adopt(this, DiskEntryStore.pending(result, header));
      return result;
    });
  };

  prototype.createBranchedSession = function (this: SessionManager, leafId: string): string | undefined {
    return recoverStateOnFailure(this, () => {
      const owned = state(this);
      if (!owned) return original.createBranchedSession.call(this, leafId);
      const result = original.createBranchedSession.call(this, leafId);
      if (!result) return result;
      // _rewriteFile adopts assistant-containing branches. Deferred branches still
      // need to be moved immediately out of the temporary materialized arrays.
      if (state(this)?.store.targetPath !== resolve(result)) {
        const target = internals(this);
        const header = target.fileEntries[0] as SessionHeader;
        const entries = target.fileEntries.slice(1) as SessionEntry[];
        const store = DiskEntryStore.fromEntries(result, header, entries, false);
        adopt(this, store);
      }
      return result;
    });
  };

  // Native create already enters the adapted newSession constructor path.

  klass.open = (path: string, sessionDir?: string, cwdOverride?: string): SessionManager => {
    const resolved = resolveSessionPath(path);
    if (existsSync(resolved) && statSync(resolved).size > 0) {
      const store = openStore(resolved);
      const cwd = cwdOverride ?? (typeof store.header.cwd === "string" ? store.header.cwd : process.cwd());
      const manager = original.create.call(SessionManager, cwd, sessionDir ?? dirname(resolved));
      return adopt(manager, store);
    }
    const manager = original.create.call(SessionManager, cwdOverride ?? process.cwd(), sessionDir ?? dirname(resolved));
    return withTemporaryManager(manager, () => {
      internals(manager).sessionFile = resolved;
      const header = internals(manager).fileEntries[0] as SessionHeader;
      return adopt(
        manager,
        existsSync(resolved) ? DiskEntryStore.published(resolved, header) : DiskEntryStore.pending(resolved, header),
      );
    });
  };

  klass.continueRecent = (cwd: string, sessionDir?: string): SessionManager => {
    const fresh = original.create.call(SessionManager, cwd, sessionDir);
    return withTemporaryManager(fresh, () => {
      const target = internals(fresh);
      const dir = target.sessionDir;
      const filterCwd = sessionDir !== undefined && !fresh.usesDefaultSessionDir();
      let candidates: string[] = [];
      try {
        candidates = readdirSync(dir)
          .filter((name) => name.endsWith(".jsonl"))
          .map((name) => resolve(dir, name))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      } catch {
        /* Native discovery tolerates directory access/stat races. */
      }
      for (const candidate of candidates) {
        let header: SessionHeader | undefined;
        try {
          header = readSessionFileHeader(candidate);
        } catch {
          continue;
        }
        if (
          !header ||
          (filterCwd &&
            (typeof header.cwd !== "string" ||
              !header.cwd ||
              resolveSessionPath(header.cwd) !== resolveSessionPath(cwd)))
        )
          continue;
        // Once selected, load/migration errors must surface, not silently start a
        // different conversation or rewrite an unrelated project's old session.
        return adopt(fresh, openStore(candidate));
      }
      return fresh;
    });
  };

  // Keep the SDK's explicitly in-memory implementation and all static listing APIs.
  klass.inMemory = original.inMemory;

  klass.forkFrom = (
    sourcePath: string,
    targetCwd: string,
    sessionDir?: string,
    options?: { id?: string },
  ): SessionManager => {
    const source = resolveSessionPath(sourcePath);
    if (!existsSync(source) || statSync(source).size === 0)
      throw new Error(`Cannot fork: source session file is empty or invalid: ${source}`);
    const sourceHeader = readSessionFileHeader(source);
    if (!sourceHeader) throw new Error("Cannot fork: source session has no header: " + source);
    const sourceVersion = sourceHeader.version ?? 1;
    const manager = original.create.call(SessionManager, targetCwd, sessionDir, { ...options, parentSession: source });
    return withTemporaryManager(manager, () => {
      const target = internals(manager);
      const targetPath = target.sessionFile!;
      const header = { ...(target.fileEntries[0] as SessionHeader), version: sourceVersion };
      const store = DiskEntryStore.published(targetPath, header, DEFAULT_SESSION_CACHE_BYTES, true);
      scanJsonl(source, ({ entry }) => {
        if (entry.type !== "session") store.append(entry as SessionEntry);
      });
      if (sourceVersion < CURRENT_SESSION_VERSION) {
        migrateSessionFile(targetPath, sourceVersion);
        return adopt(manager, DiskEntryStore.open(targetPath, DEFAULT_SESSION_CACHE_BYTES));
      }
      return adopt(manager, store);
    });
  };
}

/** Metadata-only, fail-closed traversal for bounded original-history retrieval. */
export function getDiskBackedBranch(
  manager: object,
  fromId?: string,
  maxEntries = 100_000,
): SessionEntry[] | undefined {
  const owned = states.get(manager as SessionManager);
  if (!owned) return undefined;
  const entries: SessionEntry[] = [];
  const seen = new Set<string>();
  let id = fromId ?? internals(manager as SessionManager).leafId;
  while (id) {
    if (seen.has(id)) throw new Error("Active history branch contains a cycle");
    if (entries.length >= maxEntries)
      throw new Error("Active history branch exceeds the " + maxEntries + "-entry limit");
    seen.add(id);
    const meta = owned.store.byId.get(id);
    if (!meta) throw new Error("Active history branch contains a broken parent link");
    entries.push(metadataSkeleton(meta));
    id = meta.parentId;
  }
  return entries.reverse();
}
