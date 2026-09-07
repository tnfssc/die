import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export type MemoryLockLease = (() => Promise<void>) & {
  /** Verify that this lease still owns the on-disk cooperative lock. */
  assertOwned(): Promise<void>;
};

function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

async function directory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (code(error) !== "EEXIST") throw error;
  }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe memory directory or symlink");
}

/**
 * Cooperative, project-wide writer exclusion for .agents/notes.
 *
 * Every built-in writer uses this lease. Execute-based writers must acquire it too
 * (or write only while a consolidator explicitly holds it on their behalf). This
 * protocol cannot constrain arbitrary filesystem writers that ignore the lock.
 * Never steal a lock based on age or PID.
 */
export async function acquireMemoryLock(cwd: string): Promise<MemoryLockLease> {
  const root = resolve(cwd);
  await directory(join(root, ".agents"));
  await directory(join(root, ".agents", "notes"));
  const path = join(root, ".agents", "notes", ".consolidation.lock");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (code(error) === "EEXIST")
      throw new Error(
        "Project memory is locked; wait for its owner or manually recover an abandoned .agents/notes/.consolidation.lock after verifying no writer remains.",
      );
    throw error;
  }
  const token = randomUUID();
  try {
    const handle = await open(join(path, "owner"), "wx", 0o600);
    try {
      await handle.writeFile(token, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  const assertOwned = async () => {
    if (released) throw new Error("Memory lock was already released");
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Memory lock changed ownership");
    if ((await readFile(join(path, "owner"), "utf8")) !== token) throw new Error("Memory lock changed ownership");
  };
  const release = (async () => {
    if (released) return;
    await assertOwned();
    await rm(path, { recursive: true });
    released = true;
  }) as MemoryLockLease;
  release.assertOwned = assertOwned;
  return release;
}
