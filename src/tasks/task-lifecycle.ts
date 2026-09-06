import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

/** Separate protected ownership index; never includes commands, prompts or output.
 * The newest complete records are retained within 2 MiB. The file name is derived
 * once from the owning session, not from whichever session is active later.
 */
export const TASK_LIFECYCLE_MAX_BYTES = 2 * 1024 * 1024;
const LOCK_STALE_MS = 5 * 60_000;

export type TaskLifecycleFailure = "contention" | "write";
export interface TaskLifecycleRecorderOptions {
  /** Test seam for proving that short positional writes are completed. */
  write?: typeof writeSync;
  lockStaleMs?: number;
  now?: () => number;
}

export function taskLifecycleFile(sessionFile: string): string {
  return sessionFile + ".jobs.jsonl";
}

class LockContentionError extends Error {}

function writeAll(write: typeof writeSync, fd: number, data: Buffer, position: number): void {
  let offset = 0;
  while (offset < data.length) {
    const written = write(fd, data, offset, data.length - offset, position + offset);
    if (!Number.isInteger(written) || written <= 0) throw new Error("Lifecycle write made no progress");
    offset += written;
  }
}

function readAtMost(fd: number, length: number, position: number): Buffer {
  const data = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = readSync(fd, data, offset, length - offset, position + offset);
    if (read === 0) break;
    offset += read;
  }
  return data.subarray(0, offset);
}

function readLock(path: string): { token: string; pid: number; created: number } | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 512) return;
    const value = JSON.parse(readAtMost(fd, stat.size, 0).toString("utf8"));
    if (
      !value ||
      typeof value.token !== "string" ||
      value.token.length > 100 ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      !Number.isFinite(value.created)
    )
      return;
    return value;
  } catch {
    return;
  } finally {
    if (fd !== undefined)
      try {
        closeSync(fd);
      } catch {}
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function acquireLock(
  path: string,
  write: typeof writeSync,
  now: number,
  staleMs: number,
): { fd: number; token: string } {
  const token = randomUUID();
  const create = () => {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      writeAll(write, fd, Buffer.from(JSON.stringify({ token, pid: process.pid, created: now })), 0);
      fsyncSync(fd);
      return { fd, token };
    } catch (error) {
      try {
        closeSync(fd);
      } catch {}
      try {
        unlinkSync(path);
      } catch {}
      throw error;
    }
  };

  try {
    return create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const owner = readLock(path);
  // A newly-created, not-yet-populated lock is treated as live. Malformed locks
  // become reclaimable by age through their mtime, so a crash cannot disable
  // the index forever without racing a creator's short initialization window.
  let stale = owner ? now - owner.created > staleMs || !processAlive(owner.pid) : false;
  if (!owner) {
    try {
      stale = now - statSync(path, { bigint: false }).mtimeMs > staleMs;
    } catch {
      // A disappearing lock permits one immediate create attempt below.
      stale = true;
    }
  }
  if (!stale) throw new LockContentionError("Lifecycle index is busy");

  const quarantine = path + ".stale-" + token;
  try {
    renameSync(path, quarantine);
  } catch {
    throw new LockContentionError("Lifecycle index is busy");
  }
  try {
    return create();
  } catch {
    throw new LockContentionError("Lifecycle index is busy");
  } finally {
    try {
      unlinkSync(quarantine);
    } catch {}
  }
}

function releaseLock(path: string, lock: { fd: number; token: string }): void {
  try {
    closeSync(lock.fd);
  } catch {}
  // Do not unlink a replacement lock if this owner was reclaimed after an
  // unexpectedly long filesystem stall.
  if (readLock(path)?.token !== lock.token) return;
  try {
    unlinkSync(path);
  } catch {}
}

export function createTaskLifecycleRecorder(
  sessionFile: string | undefined,
  onFailure: (failure?: TaskLifecycleFailure) => void = () => {},
  options: TaskLifecycleRecorderOptions = {},
): (record: object) => void {
  const path = sessionFile ? taskLifecycleFile(sessionFile) : undefined;
  const lockPath = path ? path + ".lock" : undefined;
  const write = options.write ?? writeSync;
  const now = options.now ?? Date.now;
  const staleMs = Math.max(1_000, options.lockStaleMs ?? LOCK_STALE_MS);
  const reported = new Set<TaskLifecycleFailure>();
  const report = (failure: TaskLifecycleFailure) => {
    // Every dropped contention is inspectable; persistent I/O failures remain
    // coalesced so diagnostics cannot flood the owning session.
    if (failure === "write" && reported.has(failure)) return;
    reported.add(failure);
    try {
      onFailure(failure);
    } catch {
      /* Observability must not prevent shutdown. */
    }
  };

  return (record) => {
    if (!path || !lockPath) return;
    let fd: number | undefined;
    let lock: { fd: number; token: string } | undefined;
    try {
      // The caller supplies the closed, metadata-only lifecycle record.
      const line = Buffer.from(JSON.stringify(record) + "\n");
      if (line.length > 16_384) throw new Error("Lifecycle record exceeds bound");
      // One nonblocking attempt serializes append and rotation across processes.
      // Contention is observable and nonfatal; callers never spin or wait.
      lock = acquireLock(lockPath, write, now(), staleMs);
      fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0)
        throw new Error("Unprotected lifecycle index");
      let offset = stat.size;
      if (offset + line.length > TASK_LIFECYCLE_MAX_BYTES) {
        const length = Math.min(offset, Math.floor(TASK_LIFECYCLE_MAX_BYTES / 2));
        const tail = readAtMost(fd, length, offset - length);
        const boundary = tail.indexOf(10);
        const retained = boundary < 0 ? Buffer.alloc(0) : tail.subarray(boundary + 1);
        ftruncateSync(fd, 0);
        writeAll(write, fd, retained, 0);
        offset = retained.length;
      }
      writeAll(write, fd, line, offset);
      fsyncSync(fd);
    } catch (error) {
      report(error instanceof LockContentionError ? "contention" : "write");
    } finally {
      if (fd !== undefined)
        try {
          closeSync(fd);
        } catch {}
      if (lock) releaseLock(lockPath, lock);
    }
  };
}
