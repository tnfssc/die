/** Export and clean-apply-check the NON-ADOPTED candidate without touching its index. */
import { execFileSync } from "node:child_process";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { verifyWebSource } from "../web-source";

const root = resolve(import.meta.dir, "../..");
const source = resolve(root, ".cache/die-t3code-v2-production");
const manifest = await Bun.file(resolve(root, ".agents/patches/t3-v2-production-source.json")).json();
const output = resolve(root, ".agents/patches/t3-v2-production-candidate.patch");
const temporary = await mkdtemp(resolve(tmpdir(), "die-candidate-export-"));
const stagedPatch = resolve(temporary, "candidate.patch");
const clean = resolve(temporary, "clean");
function git(args: string[], cwd = source, isolatedIndex = false): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(isolatedIndex ? { GIT_INDEX_FILE: resolve(temporary, "index") } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
let worktreeCreated = false;
try {
  const revision = git(["rev-parse", "HEAD"]).trim();
  if (revision !== manifest.revision) throw new Error("Candidate revision differs from manifest");
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  for (const path of untracked) {
    if (!/^(apps\/(server|web)\/src\/|packages\/[^/]+\/src\/)/.test(path)) {
      throw new Error("Review unexpected candidate untracked file before export: " + path);
    }
  }
  git(["read-tree", "HEAD"], source, true);
  git(["add", "-A", "--", "."], source, true);
  await Bun.write(stagedPatch, git(["diff", "--cached", "--binary", "HEAD"], source, true));
  await verifyWebSource(source, stagedPatch);
  git(["worktree", "add", "--detach", clean, revision]);
  worktreeCreated = true;
  git(["apply", "--check", stagedPatch], clean);
  git(["apply", stagedPatch], clean);
  await verifyWebSource(clean, stagedPatch);
  // Refuse publication if another worker changed source during clean-apply validation.
  await verifyWebSource(source, stagedPatch);
  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(stagedPatch).bytes()).digest("hex");
  await Bun.write(output + ".tmp", await Bun.file(stagedPatch).bytes());
  await rename(output + ".tmp", output);
  await Bun.write(
    resolve(root, ".agents/patches/t3-v2-production-export.json"),
    JSON.stringify(
      {
        adopted: false,
        repository: manifest.repository,
        revision,
        patch: output.slice(root.length + 1),
        patchSha256: hash,
        cleanApplyVerified: true,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log("NON-ADOPTED candidate exported and clean-apply verified: " + hash);
} finally {
  if (worktreeCreated) git(["worktree", "remove", "--force", clean]);
  await rm(temporary, { recursive: true, force: true });
}
