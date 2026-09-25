/** Isolated current-production -> pinned-preview migration and restart acceptance. */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import sourcePin from "../upstream/source.json";
import { verifyWebSource } from "../build/verify-source";

const PRODUCTION_REVISION = "a9b49a7df0a4261dcc438d4493cc3154a1d9819e";
const PRODUCTION_PATCH_COMMIT = "c6fe280";
const PRODUCTION_PATCH_SHA256 = "4d73cc3cdc4ad8962358d61bd31d178d3e47b346819bb2562d0b0d590c85ec02";
const ROOT = resolve(import.meta.dir, "../../..");
const PRODUCTION = resolve(
  process.env.T3_V2_MIGRATION_PRODUCTION ?? resolve(ROOT, `.cache/die-t3code-${PRODUCTION_REVISION}`),
);
const PREVIEW = resolve(
  process.env.T3_V2_MIGRATION_PREVIEW ??
    process.env.T3_V2_CANDIDATE ??
    resolve(ROOT, `.cache/die-t3code-${sourcePin.revision}`),
);
const PREVIEW_PATCH = resolve(
  process.env.T3_V2_MIGRATION_PREVIEW_PATCH ?? resolve(ROOT, "integrations/t3/upstream/die.patch"),
);
const TMP_ROOT = tmpdir();

function git(directory: string, args: string[], encoding: BufferEncoding | null = "utf8"): string | Buffer {
  return execFileSync("git", ["-C", directory, ...args], { encoding, maxBuffer: 32 * 1024 * 1024 });
}
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
async function assertDependencies(directory: string, label: string): Promise<void> {
  const modules = join(directory, "node_modules/.modules.yaml");
  const installedLock = join(directory, "node_modules/.pnpm/lock.yaml");
  if (!(await Bun.file(modules).exists()))
    throw new Error(`${label} dependencies are not prepared (the harness never installs)`);
  const [source, installed] = await Promise.all([
    Bun.file(join(directory, "pnpm-lock.yaml")).bytes(),
    Bun.file(installedLock).bytes(),
  ]);
  if (!Buffer.from(source).equals(Buffer.from(installed)))
    throw new Error(`${label} installed dependencies do not match pnpm-lock.yaml`);
}
async function assertCanonicalPatchedCheckout(input: {
  directory: string;
  revision: string;
  patch: string;
  label: string;
}): Promise<void> {
  if (String(git(input.directory, ["rev-parse", "HEAD"])).trim() !== input.revision)
    throw new Error(`${input.label} checkout HEAD mismatch`);
  await verifyWebSource(input.directory, input.patch);
  await assertDependencies(input.directory, input.label);
}
async function runBun(directory: string, source: string, state: string, phase?: string): Promise<void> {
  const args = [process.execPath, "--no-warnings", "--experimental-strip-types", source, state];
  if (phase) args.push(phase);
  const child = Bun.spawn(args, {
    cwd: directory,
    env: { ...process.env, TMPDIR: dirname(state) },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`runner failed (${code}): ${source}${phase ? ` [${phase}]` : ""}`);
}

const temporary = await mkdtemp(join(TMP_ROOT, "die-t3-v2-current-migration-"));
const suppliedProductionPatch = process.env.T3_V2_MIGRATION_PRODUCTION_PATCH;
const productionPatch = suppliedProductionPatch
  ? resolve(suppliedProductionPatch)
  : join(temporary, "current-production.patch");
const suffix = randomUUID();
const productionRunner = join(PRODUCTION, "apps/server/src", `.die-current-production-migration-${suffix}.ts`);
const previewRunner = join(PREVIEW, "apps/server/src", `.die-preview-migration-${suffix}.ts`);
const state = join(temporary, "state");
try {
  if (!suppliedProductionPatch) {
    const bytes = git(ROOT, ["show", `${PRODUCTION_PATCH_COMMIT}:web/t3.patch`], null) as Buffer;
    await writeFile(productionPatch, bytes);
  }
  if (sha256(await Bun.file(productionPatch).bytes()) !== PRODUCTION_PATCH_SHA256)
    throw new Error("current-production canonical patch hash mismatch");
  const previewManifest = (await Bun.file(resolve(ROOT, "integrations/t3/upstream/source.json")).json()) as {
    revision: string;
  };
  if (previewManifest.revision !== sourcePin.revision) throw new Error("preview source manifest import mismatch");
  await assertCanonicalPatchedCheckout({
    directory: PRODUCTION,
    revision: PRODUCTION_REVISION,
    patch: productionPatch,
    label: "current-production",
  });
  await assertCanonicalPatchedCheckout({
    directory: PREVIEW,
    revision: sourcePin.revision,
    patch: PREVIEW_PATCH,
    label: "preview",
  });

  await copyFile(join(import.meta.dir, "migration-fixture-production.ts.txt"), productionRunner);
  await runBun(PRODUCTION, productionRunner, state);
  await copyFile(join(import.meta.dir, "migration-fixture-preview.ts.txt"), previewRunner);
  await runBun(PREVIEW, previewRunner, state, "upgrade");
  await runBun(PREVIEW, previewRunner, state, "restart");
  console.log("migration acceptance: PASS (current production -> preview -> preview restart)");
} finally {
  await Promise.all([
    rm(productionRunner, { force: true }),
    rm(previewRunner, { force: true }),
    rm(temporary, { recursive: true, force: true }),
  ]);
}
