/** Export the canonical patched checkout without changing its index or worktree. */
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import sourcePin from "../../web/t3-source.json";
import { verifyWebSource } from "../web-source";

const root = resolve(import.meta.dir, "../..");
const source = resolve(root, ".cache/die-t3code-" + sourcePin.revision);
const temporary = await mkdtemp("/var/tmp/die-worktree-export-");
const patch = join(temporary, "canonical.patch");
const clean = join(temporary, "clean");
function git(args: string[], cwd = source, isolated = false): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(isolated ? { GIT_INDEX_FILE: join(temporary, "index") } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
try {
  if (git(["rev-parse", "HEAD"]).trim() !== sourcePin.revision) throw new Error("Canonical source HEAD mismatch");
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  for (const path of untracked) {
    if (!/^(apps\/(server|web)\/src\/|packages\/[^/]+\/src\/)/.test(path))
      throw new Error("Review unexpected source before export: " + path);
  }
  git(["read-tree", "HEAD"], source, true);
  git(["add", "-A", "--", "."], source, true);
  const bytes = git(["diff", "--cached", "--binary", "HEAD"], source, true);
  await Bun.write(patch, bytes);
  await verifyWebSource(source, patch);
  await mkdir(clean);
  git(["archive", "--format=tar", "--output=" + join(temporary, "base.tar"), "HEAD"]);
  execFileSync("tar", ["-xf", join(temporary, "base.tar"), "-C", clean]);
  git(["apply", "--check", "--binary", patch], clean);
  git(["apply", "--binary", patch], clean);
  const paths = git(["diff", "--cached", "--name-only", "-z", "HEAD"], source, true).split("\0").filter(Boolean);
  for (const path of paths) {
    const expected = await readFile(join(source, path)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const actual = await readFile(join(clean, path)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (expected === null ? actual !== null : actual === null || !expected.equals(actual))
      throw new Error("Clean-apply bytes differ: " + path);
  }
  await verifyWebSource(source, patch);
  const reproduced = git(["diff", "--cached", "--binary", "HEAD"], source, true);
  if (reproduced !== bytes) throw new Error("Canonical export changed during verification");
  const patchSha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  await Bun.write(resolve(root, "web/t3.patch.tmp"), bytes);
  await rename(resolve(root, "web/t3.patch.tmp"), resolve(root, "web/t3.patch"));
  const receipt = { revision: sourcePin.revision, patchSha256, paths: paths.length, cleanApplyVerified: true };
  await Bun.write(resolve(root, "artifacts/worktree-canonical-export.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
