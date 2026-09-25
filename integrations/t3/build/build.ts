import { execFileSync } from "node:child_process";
import { access, cp, mkdir, readdir, readFile, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { packWebArchive } from "../../../src/t3/web/archive";
import sourcePin from "../upstream/source.json";
import { verifyWebSource } from "./verify-source";

async function verifyPortableOptionalDependencies(output: string): Promise<void> {
  const pnpmStore = resolve(output, "node_modules/.pnpm");
  const ffiStore = (await readdir(pnpmStore)).find((entry) => entry.startsWith("ffi-rs@"));
  if (!ffiStore) throw new Error("Deployed web runtime is missing ffi-rs");
  const ffiPackage = resolve(pnpmStore, ffiStore, "node_modules/ffi-rs/package.json");
  const metadata = JSON.parse(await readFile(ffiPackage, "utf8")) as {
    optionalDependencies?: Record<string, string>;
  };
  const required = [
    "@yuuang/ffi-rs-darwin-arm64",
    "@yuuang/ffi-rs-darwin-x64",
    "@yuuang/ffi-rs-linux-arm64-gnu",
    "@yuuang/ffi-rs-linux-arm64-musl",
    "@yuuang/ffi-rs-linux-x64-gnu",
    "@yuuang/ffi-rs-linux-x64-musl",
    "@yuuang/ffi-rs-win32-arm64-msvc",
    "@yuuang/ffi-rs-win32-ia32-msvc",
    "@yuuang/ffi-rs-win32-x64-msvc",
  ];
  for (const name of required) {
    if (!(name in (metadata.optionalDependencies ?? {}))) throw new Error("ffi-rs no longer declares " + name);
    await access(resolve(pnpmStore, ffiStore, "node_modules", name, "package.json")).catch(() => {
      throw new Error(
        "Deployed web runtime is missing portable ffi-rs optional dependency " +
          name +
          "; update pnpm supportedArchitectures before packaging.",
      );
    });
  }
}

const root = resolve(import.meta.dir, "../../..");
export async function buildWeb(): Promise<void> {
  const source = resolve(process.env.DIE_T3_SOURCE ?? root + "/.cache/die-t3code-" + sourcePin.revision);
  const output = resolve(root, "dist/die-web");
  const patch = resolve(root, "integrations/t3/upstream/die.patch");
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
    throw new Error("T3 checkout does not match integrations/t3/upstream/source.json; use a fresh checkout.");
  }
  try {
    git(["apply", "--reverse", "--check", patch]);
  } catch {
    git(["apply", "--check", patch]);
    await run(["git", "apply", patch]);
  }
  await verifyWebSource(source, patch);
  await run(["pnpm", "install", "--frozen-lockfile"]);
  // Bundlers erase types; validate the final patched backend before packaging it.
  await run([source + "/node_modules/.bin/tsc", "--noEmit"], source + "/apps/server");
  await run(["pnpm", "--filter", "@t3tools/web", "build"]);
  await run(["pnpm", "--filter", "t3", "build:bundle"]);
  await cp(source + "/apps/web/dist", source + "/apps/server/dist/client", { recursive: true });
  await rm(output, { recursive: true, force: true });
  await run(["pnpm", "--filter", "t3", "deploy", "--prod", "--legacy", output]);
  // Legacy deploy leaves the package self-reference pointing back to the checkout.
  const selfReference = output + "/node_modules/.pnpm/node_modules/t3";
  await rm(selfReference, { force: true });
  await symlink("../../..", selfReference);
  await verifyPortableOptionalDependencies(output);
  await cp(source + "/LICENSE", output + "/LICENSE-T3CODE");
  await cp(root + "/integrations/t3/upstream/bootstrap.mjs", output + "/bootstrap.mjs");
  const patchHash = new Bun.CryptoHasher("sha256").update(await Bun.file(patch).bytes()).digest("hex");
  await Bun.write(
    output + "/SOURCE.txt",
    [
      "T3 source: " + sourcePin.repository,
      "Revision: " + sourcePin.revision,
      "Die patch: integrations/t3/upstream/die.patch",
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
