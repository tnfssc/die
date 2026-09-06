import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Cooperative, project-wide exclusion. Never steal a lock based on age/PID. */
export async function acquireMemoryLock(cwd: string): Promise<() => Promise<void>> {
  const root = resolve(cwd);
  for (const path of [join(root, ".agents"), join(root, ".agents", "notes")]) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe memory directory");
  }
  const path = join(root, ".agents", "notes", ".consolidation.lock");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "Project memory is locked; wait for its owner or manually recover an abandoned .agents/notes/.consolidation.lock after verifying no writer remains.",
      );
    throw error;
  }
  const token = randomUUID();
  try {
    await writeFile(join(path, "owner"), token, { flag: "wx", mode: 0o600 });
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Memory lock changed ownership");
    if ((await readFile(join(path, "owner"), "utf8")) !== token) throw new Error("Memory lock changed ownership");
    await rm(path, { recursive: true });
    released = true;
  };
}
