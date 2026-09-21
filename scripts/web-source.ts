import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Verify the build inputs, not merely whether our patch can reverse-apply.
 * A disposable index describes HEAD + the canonical patch without modifying the
 * checkout's index. Additional tracked or untracked source must not enter a build.
 */
export async function verifyWebSource(source: string, patch: string): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "die-web-source-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, "index") };
  function git(args: string[]): string {
    return execFileSync("git", ["-C", source, ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  try {
    git(["read-tree", "HEAD"]);
    git(["apply", "--cached", "--binary", patch]);
    try {
      git(["diff", "--no-ext-diff", "--exit-code"]);
    } catch {
      throw new Error("T3 checkout differs from HEAD + web/t3.patch; use a fresh checkout.");
    }
    if (git(["ls-files", "--others", "--exclude-standard", "-z"]).length > 0) {
      throw new Error("T3 checkout contains untracked source; use a fresh checkout.");
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
