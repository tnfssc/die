import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

const NOTES_RELATIVE = join(".agents", "notes");
const PENDING_RELATIVE = join(NOTES_RELATIVE, ".pending");
const CONSUMED_DIRECTORY = ".consumed";

export interface PendingNoteRecord {
  /** Path relative to cwd, using forward slashes. */
  path: string;
  content: string;
  /** SHA-256 of the UTF-8 file bytes. */
  hash: string;
}

export interface ConsolidatedNoteRecord {
  path: string;
  content: string;
  hash: string;
}

export interface ConsolidatedSaveReceipt {
  path: string;
  hash: string;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function portableRelative(cwd: string, path: string): string {
  return relative(resolve(cwd), path).split(sep).join("/");
}

async function checkedDirectory(path: string, create: boolean): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to traverse symlink: ${path}`);
    if (!stat.isDirectory()) throw new Error(`Managed memory path is not a directory: ${path}`);
    return true;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    if (!create) return false;
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (mkdirError) {
      if (errorCode(mkdirError) !== "EEXIST") throw mkdirError;
    }
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to traverse symlink: ${path}`);
    if (!stat.isDirectory()) throw new Error(`Managed memory path is not a directory: ${path}`);
    return true;
  }
}

async function notesRoot(cwd: string, create: boolean): Promise<string | undefined> {
  const root = resolve(cwd);
  const agents = join(root, ".agents");
  if (!(await checkedDirectory(agents, create))) return undefined;
  const notes = join(agents, "notes");
  if (!(await checkedDirectory(notes, create))) return undefined;
  return notes;
}

async function ensureChildDirectories(root: string, segments: string[]): Promise<string> {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    await checkedDirectory(current, true);
  }
  return current;
}

function topicSegments(topic: string): string[] {
  if (topic === "" || topic === ".") return [];
  if (topic.includes("\\")) throw new Error("Topic must use forward-slash separators");
  const segments = topic.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.startsWith(".") || segment.includes("\0"),
    )
  ) {
    throw new Error(`Invalid memory topic: ${topic}`);
  }
  return segments;
}

function pendingPathFromRecord(cwd: string, recordPath: string): string {
  const normalized = recordPath.replaceAll("\\", "/");
  const expectedPrefix = ".agents/notes/.pending/";
  if (!normalized.startsWith(expectedPrefix)) throw new Error(`Invalid pending note path: ${recordPath}`);
  const name = normalized.slice(expectedPrefix.length);
  if (!name || name.includes("/") || basename(name) !== name || !name.endsWith(".md")) {
    throw new Error(`Invalid pending note path: ${recordPath}`);
  }
  return join(resolve(cwd), PENDING_RELATIVE, name);
}

async function readRegularFile(path: string): Promise<string> {
  const before = await lstat(path);
  if (before.isSymbolicLink()) throw new Error(`Refusing to read symlink: ${path}`);
  if (!before.isFile()) throw new Error(`Managed note is not a regular file: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

function consumptionReceipt(record: PendingNoteRecord): { name: string; payload: string } {
  // Include both the logical path and bytes: equal content at another filename is a distinct note.
  const name = `${digest(`${record.path}\0${record.content}`)}.json`;
  const payload = JSON.stringify({ path: record.path, hash: record.hash }) + "\n";
  return { name, payload };
}

async function hasConsumptionReceipt(consumed: string | undefined, record: PendingNoteRecord): Promise<boolean> {
  if (!consumed) return false;
  const receipt = consumptionReceipt(record);
  try {
    return (await readRegularFile(join(consumed, receipt.name))) === receipt.payload;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function writeConsumptionReceipt(
  consumed: string,
  record: PendingNoteRecord,
  stillValid: () => boolean,
): Promise<boolean> {
  const receipt = consumptionReceipt(record);
  const destination = join(consumed, receipt.name);
  const temp = join(consumed, `.${receipt.name}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let tempCreated = false;
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    tempCreated = true;
    await handle.writeFile(receipt.payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    // A hard link publishes the fully-written marker atomically and fails rather than
    // replacing any existing file (including a symlink).
    if (!stillValid()) return false;
    try {
      await link(temp, destination);
    } catch (error) {
      if (errorCode(error) !== "EEXIST" || !(await hasConsumptionReceipt(consumed, record))) throw error;
    }
    return true;
  } finally {
    await handle?.close().catch(() => undefined);
    if (tempCreated) await rm(temp, { force: true }).catch(() => undefined);
  }
}

/** Snapshot only direct, not-yet-consumed Markdown children of .agents/notes/.pending. */
export async function snapshotPendingNotes(cwd: string): Promise<PendingNoteRecord[]> {
  const notes = await notesRoot(cwd, false);
  if (!notes) return [];
  const pending = join(notes, ".pending");
  if (!(await checkedDirectory(pending, false))) return [];
  const consumedPath = join(notes, CONSUMED_DIRECTORY);
  const consumed = (await checkedDirectory(consumedPath, false)) ? consumedPath : undefined;

  const entries = await readdir(pending, { withFileTypes: true });
  const records: PendingNoteRecord[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.name.endsWith(".md")) continue;
    const path = join(pending, entry.name);
    // Dirent information is not trusted: lstat/open enforce the no-symlink rule.
    const content = await readRegularFile(path);
    const record = { path: portableRelative(cwd, path), content, hash: digest(content) };
    if (!(await hasConsumptionReceipt(consumed, record))) records.push(record);
  }
  return records;
}

/**
 * Mark the supplied path/content snapshots as consumed without changing their mutable source files.
 * A later version at the same path has a different receipt identity and remains retryable.
 */
export async function consumePendingNotes(
  cwd: string,
  snapshot: readonly PendingNoteRecord[],
  stillValid: () => boolean = () => true,
): Promise<{ consumed: string[]; retained: string[] }> {
  if (!stillValid()) return { consumed: [], retained: snapshot.map((record) => record.path) };
  const notes = await notesRoot(cwd, true);
  if (!notes) return { consumed: [], retained: snapshot.map((record) => record.path) };
  const consumedDirectory = await ensureChildDirectories(notes, [CONSUMED_DIRECTORY]);

  const consumed: string[] = [];
  const retained: string[] = [];
  for (const record of snapshot) {
    // Refuse inconsistent caller-created records: snapshots produced here always satisfy this.
    if (!stillValid() || digest(record.content) !== record.hash) {
      retained.push(record.path);
      continue;
    }
    pendingPathFromRecord(cwd, record.path);
    if (await writeConsumptionReceipt(consumedDirectory, record, stillValid)) consumed.push(record.path);
    else retained.push(record.path);
  }
  return { consumed, retained };
}

/** Read a topic's index.md. The empty topic addresses .agents/notes/index.md. */
export async function readConsolidatedNote(cwd: string, topic = ""): Promise<ConsolidatedNoteRecord | undefined> {
  const notes = await notesRoot(cwd, false);
  if (!notes) return undefined;
  const segments = topicSegments(topic);
  let parent = notes;
  for (const segment of segments) {
    parent = join(parent, segment);
    if (!(await checkedDirectory(parent, false))) return undefined;
  }
  const path = join(parent, "index.md");
  try {
    const content = await readRegularFile(path);
    return { path: portableRelative(cwd, path), content, hash: digest(content) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Save one topic index while holding a cooperative per-topic lock.
 * Pass null to create a new index; pass the hash returned by readConsolidatedNote
 * when replacing one. The hash guard serializes callers of this API, but cannot
 * provide compare-and-swap guarantees against external writers that ignore the lock.
 */
export async function saveConsolidatedNote(
  cwd: string,
  topic: string,
  content: string,
  expectedHash: string | null,
): Promise<ConsolidatedSaveReceipt> {
  const segments = topicSegments(topic);
  const notes = await notesRoot(cwd, true);
  if (!notes) throw new Error("Unable to create managed notes directory");
  const parent = await ensureChildDirectories(notes, segments);
  const path = join(parent, "index.md");
  const lockPath = join(parent, ".index.md.lock");
  let lockHandle: Awaited<ReturnType<typeof open>>;
  try {
    lockHandle = await open(
      lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new Error(`Consolidated note is locked by another cooperative writer: ${portableRelative(cwd, path)}`);
    }
    throw error;
  }

  const temp = join(parent, `.index.md.${randomUUID()}.tmp`);
  let tempCreated = false;
  try {
    let existing: string | undefined;
    try {
      existing = await readRegularFile(path);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    if (existing === undefined ? expectedHash !== null : expectedHash === null || digest(existing) !== expectedHash) {
      throw new Error(`Consolidated note changed or already exists: ${portableRelative(cwd, path)}`);
    }

    const handle = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    tempCreated = true;
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    tempCreated = false;
    return { path: portableRelative(cwd, path), hash: digest(content) };
  } finally {
    if (tempCreated) await rm(temp, { force: true }).catch(() => undefined);
    await lockHandle.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

/** Verify that a receipt still describes the bytes saved at its managed topic index. */
export async function verifyConsolidatedSaveReceipt(cwd: string, receipt: ConsolidatedSaveReceipt): Promise<boolean> {
  const prefix = ".agents/notes/";
  const normalized = receipt.path.replaceAll("\\", "/");
  if (
    !normalized.startsWith(prefix) ||
    normalized.includes("/.pending/") ||
    (!normalized.endsWith("/index.md") && normalized !== ".agents/notes/index.md")
  ) {
    return false;
  }
  const topicPath = normalized === ".agents/notes/index.md" ? "" : normalized.slice(prefix.length, -"/index.md".length);
  try {
    const record = await readConsolidatedNote(cwd, topicPath);
    return record?.path === normalized && record.hash === receipt.hash;
  } catch {
    return false;
  }
}
