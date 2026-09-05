import { open, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const PREFIX_BYTES = 64 * 1024;
const READ_CONCURRENCY = 8;

interface CachedSession {
  offset: number;
  inode: bigint | number;
  pending: Buffer[];
  pendingLength: number;
  cost: number;
  entryIds: Set<string>;
  dieAgent: boolean;
  parents: Set<string>;
  metadataSize: number;
}

interface FileInfo {
  path: string;
  inode: bigint | number;
  size: number;
}

function pathKey(path: string, relativeTo?: string): string {
  return resolve(relativeTo ?? process.cwd(), path);
}

function usageCost(entry: any): number {
  let usage: any;
  if (entry?.type === "message" && (entry.message?.role === "assistant" || entry.message?.role === "toolResult")) {
    usage = entry.message.usage;
  } else if (entry?.type === "compaction" || entry?.type === "branch_summary") {
    usage = entry.usage;
  } else if (entry?.type === "custom" && entry.customType === "die-compaction-attempt") {
    usage = entry.data?.usage;
  }
  const total = usage?.cost?.total;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : 0;
}

async function mapLimited<T>(values: T[], limit: number, fn: (value: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      await fn(values[index]);
    }
  }));
}

async function jsonlFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Walk sequentially: a directory containing many nested session directories must
    // not turn into an unbounded number of simultaneous readdir calls.
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(pathKey(path));
    }
  };
  await visit(directory);
  return files;
}

function emptySession(inode: bigint | number): CachedSession {
  return {
    offset: 0,
    inode,
    pending: [],
    pendingLength: 0,
    cost: 0,
    entryIds: new Set(),
    dieAgent: false,
    parents: new Set(),
    metadataSize: -1,
  };
}

/** Incrementally totals usage belonging to die-agent descendants of one session. */
export class SessionCostTracker {
  readonly rootFile: string;
  readonly sessionDir: string;
  private sessions = new Map<string, CachedSession>();
  private refreshing?: Promise<number>;
  private total = 0;

  constructor(rootFile: string, sessionDir = dirname(rootFile)) {
    this.rootFile = pathKey(rootFile);
    this.sessionDir = pathKey(sessionDir);
  }

  get descendantCost(): number {
    return this.total;
  }

  refresh(): Promise<number> {
    if (this.refreshing) return this.refreshing;
    const refresh = this.doRefresh();
    this.refreshing = refresh;
    void refresh.then(
      () => { if (this.refreshing === refresh) this.refreshing = undefined; },
      () => { if (this.refreshing === refresh) this.refreshing = undefined; },
    );
    return refresh;
  }

  private async doRefresh(): Promise<number> {
    const files = await jsonlFiles(this.sessionDir);
    const infos: FileInfo[] = [];
    await mapLimited(files, READ_CONCURRENCY, async (path) => {
      if (path === this.rootFile) return;
      try {
        const info = await stat(path, { bigint: true });
        if (info.isFile()) infos.push({ path, inode: info.ino, size: Number(info.size) });
      } catch {
        // It may have disappeared after readdir.
      }
    });

    const present = new Set(infos.map(({ path }) => path));
    for (const path of this.sessions.keys()) if (!present.has(path)) this.sessions.delete(path);

    // Relation discovery reads only a fixed-size prefix. In particular, a large
    // unrelated transcript is never parsed merely because it shares sessionDir.
    await mapLimited(infos, READ_CONCURRENCY, async ({ path, inode, size }) => {
      let cached = this.sessions.get(path);
      if (!cached || cached.inode !== inode || size < cached.offset) {
        cached = emptySession(inode);
        this.sessions.set(path, cached);
      }
      if (cached.metadataSize === size || (cached.dieAgent && cached.metadataSize >= 0)) return;
      await this.readMetadata(path, cached, size);
    });

    const descendants = new Set<string>([this.rootFile]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [path, session] of this.sessions) {
        if (descendants.has(path) || !session.dieAgent) continue;
        if ([...session.parents].some((parent) => descendants.has(parent))) {
          descendants.add(path);
          changed = true;
        }
      }
    }

    const reachable = infos.filter(({ path }) => descendants.has(path));
    await mapLimited(reachable, READ_CONCURRENCY, async ({ path, inode, size }) => {
      const cached = this.sessions.get(path);
      if (!cached || cached.inode !== inode) return;
      await this.readUsage(path, cached, size);
    });

    let total = 0;
    for (const path of descendants) if (path !== this.rootFile) total += this.sessions.get(path)?.cost ?? 0;
    this.total = total;
    return total;
  }

  private async readMetadata(path: string, session: CachedSession, size: number): Promise<void> {
    let handle;
    try {
      handle = await open(path, "r");
      const length = Math.min(size, PREFIX_BYTES);
      const data = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(data, 0, length, 0);
      let headerParent: string | undefined;
      const explicitParents: string[] = [];
      let hasFallbackMarker = false;
      let start = 0;
      for (;;) {
        const newline = data.indexOf(10, start);
        if (newline < 0 || newline >= bytesRead) break;
        let end = newline;
        if (end > start && data[end - 1] === 13) end--;
        try {
          const entry = JSON.parse(data.toString("utf8", start, end));
          if (entry?.type === "session" && typeof entry.parentSession === "string") {
            headerParent = pathKey(entry.parentSession, dirname(path));
          }
          if (entry?.type === "custom" && entry.customType === "die-agent") {
            if (typeof entry.data?.parentSessionFile === "string") {
              explicitParents.push(pathKey(entry.data.parentSessionFile, dirname(path)));
            } else {
              hasFallbackMarker = true;
            }
          }
        } catch {
          // Ignore malformed complete prefix records.
        }
        start = newline + 1;
      }

      session.parents.clear();
      // A normal pi fork copies custom entries. Its new header points at the
      // fork source while copied die-agent metadata still points elsewhere.
      const copiedMetadata = Boolean(headerParent && explicitParents.some((parent) => parent !== headerParent));
      session.dieAgent = !copiedMetadata && (explicitParents.length > 0 || hasFallbackMarker);
      if (session.dieAgent) {
        for (const parent of explicitParents) session.parents.add(parent);
        if (explicitParents.length === 0 && hasFallbackMarker && headerParent) session.parents.add(headerParent);
      }
      session.metadataSize = size;
    } catch {
      // It may be replaced while scanning. Retry on a later refresh.
      session.metadataSize = -1;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  private async readUsage(path: string, session: CachedSession, size: number): Promise<void> {
    const available = size - session.offset;
    if (available <= 0) return;
    let handle;
    try {
      handle = await open(path, "r");
      let remaining = available;
      while (remaining > 0) {
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, session.offset);
        if (!bytesRead) break;
        session.offset += bytesRead;
        remaining -= bytesRead;
        this.consume(session, chunk.subarray(0, bytesRead));
      }
    } catch {
      // It may disappear or be replaced while being consumed.
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  private consume(session: CachedSession, chunk: Buffer): void {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(10, start);
      if (newline < 0) break;
      let piece = chunk.subarray(start, newline);
      if (piece.length && piece[piece.length - 1] === 13) piece = piece.subarray(0, -1);
      let line: Buffer;
      if (session.pendingLength) {
        session.pending.push(piece);
        line = Buffer.concat(session.pending, session.pendingLength + piece.length);
        session.pending = [];
        session.pendingLength = 0;
      } else {
        line = piece;
      }
      if (line.length) {
        try {
          const entry = JSON.parse(line.toString("utf8"));
          const id = typeof entry?.id === "string" ? entry.id : undefined;
          const cost = usageCost(entry);
          if (cost && (!id || !session.entryIds.has(id))) session.cost += cost;
          if (id) session.entryIds.add(id);
        } catch {
          // Ignore a malformed complete record.
        }
      }
      start = newline + 1;
    }
    if (start < chunk.length) {
      const tail = chunk.subarray(start);
      session.pending.push(Buffer.from(tail));
      session.pendingLength += tail.length;
    }
  }
}
