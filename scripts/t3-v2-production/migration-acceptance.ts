/** Reproducible, isolated v0.4 (719a76) -> current V2 migration acceptance. */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import sourcePin from "../../web/t3-source.json";

const OLD_REVISION = "719a76ca1dbf5490f1aa33ffb9966301e02be9a9";
const ROOT = resolve(import.meta.dir, "../..");
const OLD = resolve(ROOT, `.cache/die-t3code-${OLD_REVISION}`);
const CURRENT = resolve(process.env.T3_V2_CANDIDATE ?? resolve(ROOT, ".cache/die-t3code-" + sourcePin.revision));
const PATCH = resolve(process.env.T3_V2_MIGRATION_PATCH ?? resolve(ROOT, "web/t3.patch"));
const MANIFEST = resolve(ROOT, "web/t3-source.json");
const TMP_ROOT = tmpdir();

function git(directory: string, args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
}
async function verifyFocusedCandidate(): Promise<void> {
  const indexDirectory = await mkdtemp(join(TMP_ROOT, "die-t3-v2-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(indexDirectory, "index") };
  const focused = [
    "apps/server/src/persistence",
    "apps/server/src/orchestration-v2/LegacyV1ThreadImporter.ts",
    "pnpm-lock.yaml",
    "package.json",
    "pnpm-workspace.yaml",
  ];
  try {
    execFileSync("git", ["-C", CURRENT, "read-tree", "HEAD"], { env, stdio: "ignore" });
    execFileSync("git", ["-C", CURRENT, "apply", "--cached", "--binary", PATCH], { env, stdio: "ignore" });
    execFileSync("git", ["-C", CURRENT, "diff", "--no-ext-diff", "--exit-code", "--", ...focused], {
      env,
      stdio: "ignore",
    });
  } catch {
    throw new Error("candidate migration/importer inputs differ from the frozen candidate patch");
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}
async function runNode(directory: string, source: string, state: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "--no-warnings", "--experimental-strip-types", source, state], {
    cwd: directory,
    env: { ...process.env, TMPDIR: dirname(state) },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`runner failed (${code}): ${source}`);
}

const manifest = (await Bun.file(MANIFEST).json()) as { revision: string };
if (git(OLD, ["rev-parse", "HEAD"]) !== OLD_REVISION) throw new Error("old checkout HEAD mismatch");
const oldInputs = [
  "apps/server/src/persistence",
  "packages/shared/src/nodeSqliteClient.ts",
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
];
if (git(OLD, ["status", "--porcelain", "--untracked-files=no", "--", ...oldInputs]) !== "")
  throw new Error("old migration source or lockfiles differ from frozen 719a76 checkout");
if (!(await Bun.file(join(OLD, "node_modules/.modules.yaml")).exists()))
  throw new Error("old frozen dependencies are not prepared (this test never installs)");
if (
  !Buffer.from(await Bun.file(join(OLD, "pnpm-lock.yaml")).bytes()).equals(
    Buffer.from(await Bun.file(join(OLD, "node_modules/.pnpm/lock.yaml")).bytes()),
  )
)
  throw new Error("old installed dependencies do not match pnpm-lock.yaml");
if (git(CURRENT, ["rev-parse", "HEAD"]) !== manifest.revision) throw new Error("candidate checkout HEAD mismatch");
if (!(await Bun.file(join(CURRENT, "node_modules/.modules.yaml")).exists()))
  throw new Error("candidate frozen dependencies are not prepared (this test never installs)");
if (
  !Buffer.from(await Bun.file(join(CURRENT, "pnpm-lock.yaml")).bytes()).equals(
    Buffer.from(await Bun.file(join(CURRENT, "node_modules/.pnpm/lock.yaml")).bytes()),
  )
)
  throw new Error("candidate installed dependencies do not match pnpm-lock.yaml");
await verifyFocusedCandidate();

const temporary = await mkdtemp(join(TMP_ROOT, "die-t3-v2-migration-"));
const suffix = randomUUID();
const oldRunner = join(OLD, "apps/server/src", `.die-migration-old-${suffix}.ts`);
const currentRunner = join(CURRENT, "apps/server/src", `.die-migration-current-${suffix}.ts`);
const state = join(temporary, "state.sqlite");
try {
  await copyFile(join(import.meta.dir, "migration-fixture-old.ts.txt"), oldRunner);
  await runNode(OLD, oldRunner, state);
  await copyFile(join(import.meta.dir, "migration-fixture-current.ts.txt"), currentRunner);
  await runNode(CURRENT, currentRunner, state);
  console.log("migration acceptance: PASS (fixture + migrate/import + restart/idempotency)");
} finally {
  await Promise.all([
    rm(oldRunner, { force: true }),
    rm(currentRunner, { force: true }),
    rm(temporary, { recursive: true, force: true }),
  ]);
}
