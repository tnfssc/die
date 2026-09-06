import { dlopen, FFIType } from "bun:ffi";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readSync,
  statSync,
  writeSync,
} from "node:fs";

/** Separate protected ownership index; never includes commands, prompts or output.
 * The newest complete records are retained within 2 MiB. The file name is derived
 * once from the owning session, not from whichever session is active later.
 */
export const TASK_LIFECYCLE_MAX_BYTES = 2 * 1024 * 1024;

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
type Flock = (fd: number, operation: number) => number;

export type TaskLifecycleFailure = "contention" | "locking" | "write";
export interface TaskLifecycleRecorderOptions {
  /** Test seam for proving that short positional writes are completed. */
  write?: typeof writeSync;
  /** Test seam for a missing or failing advisory-lock implementation. */
  flock?: Flock;
}

export function taskLifecycleFile(sessionFile: string): string {
  return sessionFile + ".jobs.jsonl";
}

class LockContentionError extends Error {}
class LockUnavailableError extends Error {}

// Keep the dlopen handle alive for the process lifetime. Bun's FFI is bundled in
// compiled executables, so this needs no helper executable or package. We only
// claim support where Linux's flock(2) ABI and constants are known here. Other
// platforms fail closed: lifecycle diagnostics are dropped and reported rather
// than being written without inter-process exclusion.
let libc: unknown;
let systemFlock: Flock | undefined;
let flockResolved = false;
function resolveFlock(): Flock {
  if (flockResolved) {
    if (!systemFlock) throw new LockUnavailableError("Advisory locking is unavailable");
    return systemFlock;
  }
  flockResolved = true;
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new LockUnavailableError("Advisory locking is unsupported on this platform");
  try {
    const library = dlopen("libc.so.6", {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    });
    libc = library;
    systemFlock = library.symbols.flock;
    return systemFlock;
  } catch {
    throw new LockUnavailableError("Advisory locking is unavailable");
  }
}

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

export function createTaskLifecycleRecorder(
  sessionFile: string | undefined,
  onFailure: (failure?: TaskLifecycleFailure) => void = () => {},
  options: TaskLifecycleRecorderOptions = {},
): (record: object) => void {
  const path = sessionFile ? taskLifecycleFile(sessionFile) : undefined;
  const write = options.write ?? writeSync;
  const reported = new Set<TaskLifecycleFailure>();
  const report = (failure: TaskLifecycleFailure) => {
    // Every dropped contention is inspectable; persistent backend/I/O failures
    // remain coalesced so diagnostics cannot flood the owning session.
    if (failure !== "contention" && reported.has(failure)) return;
    reported.add(failure);
    try {
      onFailure(failure);
    } catch {
      /* Observability must not prevent shutdown. */
    }
  };

  return (record) => {
    if (!path) return;
    let fd: number | undefined;
    let lock: Flock | undefined;
    let locked = false;
    try {
      // Resolve before O_CREAT: an unsupported runtime must not leave even an
      // empty index suggesting that lifecycle records were safely persisted.
      lock = options.flock ?? resolveFlock();
      const line = Buffer.from(JSON.stringify(record) + "\n");
      if (line.length > 16_384) throw new Error("Lifecycle record exceeds bound");
      fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);

      // The advisory lock is attached to the index's open file description.
      // No pathname ownership or stale-age decision is involved; the kernel
      // releases it on close and after SIGKILL/process death.
      let lockResult: number;
      try {
        lockResult = lock(fd, LOCK_EX | LOCK_NB);
      } catch {
        throw new LockUnavailableError("Advisory locking failed");
      }
      if (lockResult !== 0) throw new LockContentionError("Lifecycle index is busy");
      locked = true;

      const stat = fstatSync(fd);
      const current = statSync(path);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.dev !== current.dev ||
        stat.ino !== current.ino ||
        (stat.mode & 0o077) !== 0
      )
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
      report(
        error instanceof LockContentionError
          ? "contention"
          : error instanceof LockUnavailableError
            ? "locking"
            : "write",
      );
    } finally {
      if (fd !== undefined) {
        if (locked && lock)
          try {
            lock(fd, LOCK_UN);
          } catch {}
        try {
          closeSync(fd);
        } catch {}
      }
    }
  };
}
