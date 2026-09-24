import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "scripts/smoke.sh");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "die-smoke-test-"));
  roots.push(root);
  await mkdir(join(root, "bin"));
  await mkdir(join(root, "dist"));
  await writeFile(
    join(root, "bin/bun"),
    '#!/bin/sh\nif [ "$1" = run ] && [ "$2" = build ]; then\n  echo build >> builds\n  cp fixture-die dist/die\n  exit\nfi\nif [ "$1" = -e ]; then\n  echo 1.2.3\n  exit\nfi\nexit 1\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(root, "fixture-die"),
    '#!/bin/sh\n/bin/mkdir -p "$HOME/.die"\ncase "$1" in\n  --version) echo 1.2.3 ;;\n  --help) echo "die - AI coding assistant" ;;\nesac\n',
    { mode: 0o755 },
  );
  const run = (args: string[] = []) =>
    Bun.spawnSync(["sh", script, ...args], {
      cwd: root,
      env: { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH },
      stdout: "pipe",
      stderr: "pipe",
    });
  const builds = async () => (await readFile(join(root, "builds"), "utf8")).trim().split("\n").length;
  return { root, run, builds };
}

test("standalone smoke builds by default, while explicit reuse keeps the same CLI checks without rebuilding", async () => {
  const { root, run, builds } = await fixture();
  expect(run().exitCode).toBe(0);
  expect(await builds()).toBe(1);
  expect(run(["--reuse-build"]).exitCode).toBe(0);
  expect(await builds()).toBe(1);
  // Reuse must still execute the CLI version/help assertions.
  await writeFile(join(root, "dist/die"), "#!/bin/sh\necho wrong-version\n", { mode: 0o755 });
  expect(run(["--reuse-build"]).exitCode).not.toBe(0);
  expect(await builds()).toBe(1);
});

test("reuse requires an executable binary and invalid arguments cannot trigger a build", async () => {
  const { root, run } = await fixture();
  expect(run(["--reuse-build"]).exitCode).not.toBe(0);
  await writeFile(join(root, "dist/die"), "not executable");
  expect(run(["--reuse-build"]).exitCode).not.toBe(0);
  for (const args of [["--unknown"], ["--reuse-build", "--unknown"], ["--", "--reuse-build"]]) {
    const result = run(args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("usage:");
  }
  expect(await Bun.file(join(root, "builds")).exists()).toBe(false);
});

test("CI and release smoke reuse their preceding build", async () => {
  for (const name of ["ci", "release"]) {
    const workflow = await Bun.file(join(import.meta.dir, "..", ".github/workflows", name + ".yml")).text();
    const build = workflow.indexOf("run: bun run build 2>&1");
    const smoke = workflow.indexOf("run: bun run smoke -- --reuse-build 2>&1");
    expect(build).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(build);
    expect(workflow.slice(smoke, workflow.indexOf("\n", smoke))).toContain(`artifacts/${name}/smoke.log`);
  }
});
