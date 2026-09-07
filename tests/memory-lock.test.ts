import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireMemoryLock } from "../src/memory/lock";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function project() {
  const cwd = await mkdtemp(join(tmpdir(), "die-memory-lock-"));
  dirs.push(cwd);
  await mkdir(join(cwd, ".agents/notes"), { recursive: true });
  return cwd;
}
test("project exclusion, explicit release and reacquisition", async () => {
  const cwd = await project();
  const release = await acquireMemoryLock(cwd);
  await expect(acquireMemoryLock(cwd)).rejects.toThrow("locked");
  await release();
  await release();
  await (await acquireMemoryLock(cwd))();
});
test("never reclaims abandoned or replaced owners", async () => {
  const cwd = await project();
  const release = await acquireMemoryLock(cwd);
  await writeFile(join(cwd, ".agents/notes/.consolidation.lock/owner"), "another owner");
  await expect(release()).rejects.toThrow("ownership");
  await expect(acquireMemoryLock(cwd)).rejects.toThrow("locked");
});
test("rejects symlinked managed ancestors", async () => {
  const cwd = await project();
  await rm(join(cwd, ".agents/notes"), { recursive: true });
  await symlink(await project(), join(cwd, ".agents/notes"));
  await expect(acquireMemoryLock(cwd)).rejects.toThrow("Unsafe");
});

test("creates safe managed directories for an ordinary writer", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "die-memory-lock-empty-"));
  dirs.push(cwd);
  const lease = await acquireMemoryLock(cwd);
  expect(await Bun.file(join(cwd, ".agents/notes/.consolidation.lock/owner")).exists()).toBe(true);
  await lease();
});
