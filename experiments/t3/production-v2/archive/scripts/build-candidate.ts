/** Build an explicitly NON-ADOPTED, exact-input candidate without editing web/t3-*. */
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { packWebArchive } from "../../src/t3/web/archive";
import { verifyWebSource } from "../web-source";

const root = resolve(import.meta.dir, "../..");
const source = resolve(root, ".cache/die-t3code-v2-production");
const patch = resolve(root, ".agents/patches/t3-v2-production-candidate.patch");
const pin = await Bun.file(resolve(root, ".agents/patches/t3-v2-production-source.json")).json();
if (process.env.T3_V2_BUILD_CANDIDATE !== "1") {
  throw new Error("Set T3_V2_BUILD_CANDIDATE=1 to build the non-adopted candidate (no install).");
}
const revision = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (revision !== pin.revision) throw new Error("Candidate HEAD does not match its manifest");
await verifyWebSource(source, patch);
const patchHash = new Bun.CryptoHasher("sha256").update(await Bun.file(patch).bytes()).digest("hex");
async function run(args: string[], cwd = source): Promise<void> {
  const child = Bun.spawn(args, {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    // Validate/build the reviewed installed workspace; pnpm must not implicitly
    // reinstall/purge dependencies merely because a preceding deploy updated
    // its workspace-status metadata. Explicit dependency installation is not this script's job.
    env: { ...process.env, pnpm_config_verify_deps_before_run: "false" },
  });
  if ((await child.exited) !== 0) throw new Error("Candidate command failed: " + args.join(" "));
}
const typecheckVerified = process.env.T3_V2_SKIP_CANDIDATE_TYPECHECK !== "1";
if (typecheckVerified) await run(["pnpm", "typecheck"]);
else
  console.warn(
    "Initial browser build only: candidate typecheck deferred; final rebuild must not set T3_V2_SKIP_CANDIDATE_TYPECHECK",
  );
await run(["pnpm", "--filter", "@t3tools/web", "build"]);
await run(["pnpm", "--filter", "t3", "build:bundle"]);
// Recheck after commands, so build-time source mutations are not packaged silently.
await verifyWebSource(source, patch);
await cp(source + "/apps/web/dist", source + "/apps/server/dist/client", { recursive: true });
const output = resolve(root, "dist/die-web");
await mkdir(resolve(root, "dist"), { recursive: true });
await rm(output, { recursive: true, force: true });
await run(["pnpm", "--filter", "t3", "deploy", "--prod", "--legacy", output]);
await rm(output + "/node_modules/.pnpm/node_modules/t3", { force: true });
await symlink("../../..", output + "/node_modules/.pnpm/node_modules/t3");
await cp(source + "/LICENSE", output + "/LICENSE-T3CODE");
await cp(root + "/web/die-web-bootstrap.mjs", output + "/bootstrap.mjs");
await Bun.write(
  output + "/SOURCE.txt",
  [
    "NON-ADOPTED production validation candidate",
    "T3 source: " + pin.repository,
    "Revision: " + revision,
    "Die patch: .agents/patches/t3-v2-production-candidate.patch",
    "Patch-SHA256: " + patchHash,
    "Bun runtime: " + Bun.version,
    "Native assets: " + process.platform + "-" + process.arch,
    "",
  ].join("\n"),
);
await packWebArchive(output, root + "/dist/die-web.archive.gz", { exclude: ["launcher.mjs", "t3"] });
await run(["bun", "run", "prepare:assets"], root);
await run(["bun", "scripts/build.ts", "--reuse-web", "--outfile=dist/die-t3-v2-candidate"], root);
const executable = root + "/dist/die-t3-v2-candidate";
const executableHash = new Bun.CryptoHasher("sha256").update(await Bun.file(executable).bytes()).digest("hex");
await Bun.write(
  root + "/dist/t3-v2-candidate-build.json",
  JSON.stringify(
    {
      adopted: false,
      revision,
      patchHash,
      executable,
      executableHash,
      typecheckVerified,
    },
    null,
    2,
  ) + "\n",
);
console.log("Candidate only: " + executable + " sha256=" + executableHash);
