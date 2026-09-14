import { execFileSync } from "node:child_process";
import { access, cp, mkdir, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { packWebArchive } from "../src/web/archive";
import sourcePin from "../web/t3-source.json";

const root = resolve(import.meta.dir, "..");
export async function buildWeb(): Promise<void> {
  const source = resolve(process.env.DIE_T3_SOURCE ?? root + "/.cache/die-t3code");
  const output = resolve(root, "dist/die-web");
  const patch = resolve(root, "web/t3.patch");
  async function run(args: string[], cwd = source): Promise<void> {
    const child = Bun.spawn(args, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    const code = await child.exited;
    if (code !== 0) throw new Error(args[0] + " failed (exit " + code + ")");
  }
  function git(args: string[]): string {
    return execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  try {
    await access(source + "/.git");
  } catch {
    await mkdir(source, { recursive: true });
    await run(["git", "init"]);
    await run(["git", "fetch", "--depth", "1", sourcePin.repository, sourcePin.revision]);
    await run(["git", "checkout", "--detach", "FETCH_HEAD"]);
  }
  if (git(["rev-parse", "HEAD"]) !== sourcePin.revision) {
    throw new Error("T3 checkout does not match web/t3-source.json; use a fresh checkout.");
  }
  try {
    git(["apply", "--reverse", "--check", patch]);
  } catch {
    git(["apply", "--check", patch]);
    await run(["git", "apply", patch]);
  }
  await run(["pnpm", "install", "--frozen-lockfile"]);
  await run(["pnpm", "--filter", "@t3tools/web", "build"]);
  await run(["pnpm", "--filter", "t3", "build:bundle"]);
  await cp(source + "/apps/web/dist", source + "/apps/server/dist/client", { recursive: true });
  await rm(output, { recursive: true, force: true });
  await run(["pnpm", "--filter", "t3", "deploy", "--prod", "--legacy", output]);
  // Legacy deploy leaves the package self-reference pointing back to the checkout.
  const selfReference = output + "/node_modules/.pnpm/node_modules/t3";
  await rm(selfReference, { force: true });
  await symlink("../../..", selfReference);
  await cp(source + "/LICENSE", output + "/LICENSE-T3CODE");
  await cp(root + "/support/die-web-bootstrap.mjs", output + "/bootstrap.mjs");
  const patchHash = new Bun.CryptoHasher("sha256").update(await Bun.file(patch).bytes()).digest("hex");
  await Bun.write(
    output + "/SOURCE.txt",
    [
      "T3 source: " + sourcePin.repository,
      "Revision: " + sourcePin.revision,
      "Die patch: web/t3.patch",
      "Patch-SHA256: " + patchHash,
      "Bun runtime: " + Bun.version,
      "Native assets: " + process.platform + "-" + process.arch,
      "",
    ].join("\n"),
  );
  const archive = resolve(root, "dist/die-web.archive.gz");
  const hash = await packWebArchive(output, archive, { exclude: ["launcher.mjs", "t3"] });
  console.log("Built " + archive + " (sha256 " + hash + ")");
}

if (import.meta.main) await buildWeb();
