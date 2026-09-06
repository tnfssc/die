import { closeSync, constants, fstatSync, fsyncSync, openSync, readSync, ftruncateSync, writeSync } from "node:fs";

/** Separate protected ownership index; never includes commands, prompts or output.
 * The newest complete records are retained within 2 MiB. The file name is derived
 * once from the owning session, not from whichever session is active later.
 */
export const TASK_LIFECYCLE_MAX_BYTES = 2 * 1024 * 1024;
export function taskLifecycleFile(sessionFile: string): string {
  return sessionFile + ".jobs.jsonl";
}

export function createTaskLifecycleRecorder(
  sessionFile: string | undefined,
  onFailure: () => void = () => {},
): (record: object) => void {
  const path = sessionFile ? taskLifecycleFile(sessionFile) : undefined;
  let reported = false;
  return (record) => {
    if (!path) return;
    let fd: number | undefined;
    try {
      // The caller supplies the closed, metadata-only lifecycle record.
      const line = Buffer.from(JSON.stringify(record) + "\n");
      if (line.length > 16_384) throw new Error("Lifecycle record exceeds bound");
      fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0)
        throw new Error("Unprotected lifecycle index");
      let offset = stat.size;
      if (offset + line.length > TASK_LIFECYCLE_MAX_BYTES) {
        const length = Math.min(offset, Math.floor(TASK_LIFECYCLE_MAX_BYTES / 2));
        const tail = Buffer.alloc(length);
        readSync(fd, tail, 0, length, offset - length);
        const boundary = tail.indexOf(10);
        const retained = boundary < 0 ? Buffer.alloc(0) : tail.subarray(boundary + 1);
        ftruncateSync(fd, 0);
        writeSync(fd, retained, 0, retained.length, 0);
        offset = retained.length;
      }
      writeSync(fd, line, 0, line.length, offset);
      fsyncSync(fd);
    } catch {
      if (!reported) {
        reported = true;
        try {
          onFailure();
        } catch {
          /* Observability must not prevent shutdown. */
        }
      }
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          /* Optional recorder remains nonfatal. */
        }
      }
    }
  };
}
