import { afterAll, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "run.sh");
const temporary: string[] = [];
afterAll(async () => Promise.all(temporary.map((path) => rm(path, { recursive: true, force: true }))));

async function run(offset: string, args: string[] = [], env: Record<string, string> = {}) {
  // Fixture copies replace constants. The shipped runner cannot override pin or state.
  const selectedScript = env.T3_TEST_SCRIPT ?? script;
  const p = Bun.spawn(["bash", selectedScript, "dry-run", ...args], {
    env: { ...process.env, ...env, T3_V2_PORT_OFFSET: offset },
    stdout: "pipe", stderr: "pipe",
  });
  return { code: await p.exited, stdout: await new Response(p.stdout).text(), stderr: await new Response(p.stderr).text() };
}

async function command(cwd: string, argv: string[]) {
  const p = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  const stdout = await new Response(p.stdout).text();
  const stderr = await new Response(p.stderr).text();
  if (code !== 0) throw new Error(`${argv.join(" ")} failed: ${stderr}`);
  return stdout;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "t3-v2-isolation-"));
  temporary.push(root);
  const source = join(root, "upstream");
  await mkdir(source, { recursive: true });
  await command(source, ["git", "init", "--quiet"]);
  await command(source, ["git", "config", "user.email", "fixture@example.invalid"]);
  await command(source, ["git", "config", "user.name", "Fixture"]);
  await writeFile(join(source, "patched.txt"), "before\n");
  await writeFile(join(source, "ordinary.txt"), "clean\n");
  await command(source, ["git", "add", "."]);
  await command(source, ["git", "commit", "--quiet", "-m", "fixture"]);
  const pin = (await command(source, ["git", "rev-parse", "HEAD"])).trim();
  await writeFile(join(source, "patched.txt"), "after\n");
  const patch = join(root, "expected.patch");
  await writeFile(patch, await command(source, ["git", "diff", "--binary", "HEAD"]));
  await mkdir(join(source, "node_modules"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const corepack = join(bin, "corepack");
  await writeFile(corepack, "#!/bin/sh\necho safe-fixture-corepack\nexit 0\n");
  await chmod(corepack, 0o755);
  const fixtureScript = join(root, "run-fixture.sh");
  const scriptText = await Bun.file(script).text();
  await writeFile(fixtureScript, scriptText.replace('RUNTIME="$SCRIPT_DIR/.runtime"', `RUNTIME=${JSON.stringify(root)}`).replace('PIN="a9b49a7df0a4261dcc438d4493cc3154a1d9819e"', `PIN=${JSON.stringify(pin)}`).replace('PATCH="$SCRIPT_DIR/upstream.patch"', `PATCH=${JSON.stringify(patch)}`));
  return { root, source, patch, pin, env: { T3_TEST_SCRIPT: fixtureScript, PATH: `${bin}:${process.env.PATH}` } };
}

test("rejects nonnumeric and oversized port offsets before shell arithmetic", async () => {
  for (const offset of ["-1", "1+2", "x[$(echo forbidden)]", "999999", "99999"]) {
    expect((await run(offset, [], { T3_V2_RUNTIME: join(tmpdir(), "missing-t3-v2-runtime") })).code).not.toBe(0);
  }
});

test("normalizes a leading-zero offset as decimal", async () => {
  const f = await fixture();
  const result = await run("09000", [], f.env);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("safe-fixture-corepack");
  expect(result.stderr).not.toContain("value too great for base");
});

test("dev launch cannot override loopback or isolated state", async () => {
  const result = await run("19000", ["--host", "0.0.0.0"], { T3_V2_RUNTIME: join(tmpdir(), "missing-t3-v2-runtime") });
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("do not accept overrides");
});

test("rejects tracked drift but permits staged unique integration diagnostics", async () => {
  const dirty = await fixture();
  await writeFile(join(dirty.source, "ordinary.txt"), "dirty\n");
  let result = await run("09000", [], dirty.env);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("differs from the patched baseline");

  await writeFile(join(dirty.source, "ordinary.txt"), "clean\n");
  const diagnostic = join(dirty.source, "apps/server/src/orchestration-v2/Adapters/combinedPiDie.integration.test.ts");
  await mkdir(resolve(diagnostic, ".."), { recursive: true });
  await writeFile(diagnostic, "// fixture only\n");
  await command(dirty.source, ["git", "add", "apps/server/src/orchestration-v2/Adapters/combinedPiDie.integration.test.ts"]);
  result = await run("09000", [], dirty.env);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("safe-fixture-corepack");
});
