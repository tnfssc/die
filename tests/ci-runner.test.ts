import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function run(lane: "linux" | "macos", fail = "") {
  const root = mkdtempSync(join(tmpdir(), "die-ci-runner-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  const web = join(root, "web-source");
  mkdirSync(join(root, "scripts"));
  mkdirSync(bin);
  copyFileSync(resolve(import.meta.dir, "../scripts/ci.sh"), join(root, "scripts/ci.sh"));
  for (const subdir of ["apps/server", "apps/web", "packages/contracts", "packages/client-runtime"]) {
    const dir = join(web, subdir);
    mkdirSync(join(dir, "../../node_modules/.bin"), { recursive: true });
    mkdirSync(dir, { recursive: true });
  }
  const stub = `#!/usr/bin/env bash
printf '%s|%s|%s\n' "$(basename "$0")" "$PWD" "$*" >> "$CALLS"
if [[ "$(basename "$0")" == bun && "$1" == -e ]]; then echo pinned-revision; exit 0; fi
if [[ "$*" == "$FAIL" ]]; then echo intentional-failure; exit 37; fi
if [[ "$*" == "test ./tests" ]]; then echo "llm=$DIE_RUN_LLM_TESTS"; fi
echo "completed $*"
`;
  writeFileSync(join(bin, "bun"), stub, { mode: 0o755 });
  for (const subdir of ["apps/server", "apps/web", "packages/contracts", "packages/client-runtime"]) {
    writeFileSync(join(web, subdir, "../../node_modules/.bin/vp"), stub, { mode: 0o755 });
  }
  const calls = join(root, "calls");
  const result = spawnSync("bash", [join(root, "scripts/ci.sh"), lane], {
    cwd: root,
    env: { ...process.env, PATH: bin + ":" + process.env.PATH, DIE_T3_SOURCE: web, CALLS: calls, FAIL: fail },
    encoding: "utf8",
  });
  return { root, result, calls: readFileSync(calls, "utf8").trim().split("\n") };
}

test("Linux runs all ordered gates in the pinned web checkout with deterministic tests", () => {
  const { root, result, calls } = run("linux");
  expect(result.status).toBe(0);
  expect(calls.map((line) => line.split("|")[2].split(" ").slice(0, 3).join(" "))).toEqual([
    "install --frozen-lockfile",
    '-e console.log(require("./web/t3-source.json").revision)',
    "run format:check",
    "run lint",
    "run check",
    "run build",
    "scripts/offline-openai-default-transport.ts",
    "test run src/provider/Layers/PiProvider.test.ts",
    "test run --project",
    "test run src/browserProfile.test.ts",
    "test run src/state/orchestrationV2Projection.test.ts",
    "test ./tests",
    "run smoke --",
  ]);
  expect(calls[7]).toContain("/web-source/apps/server|");
  expect(calls[11]).toContain("test ./tests");
  expect(readFileSync(join(root, "artifacts/ci/tests.log"), "utf8")).toContain("llm=0");
  expect(readFileSync(join(root, "artifacts/ci/smoke.log"), "utf8")).toContain("completed");
});

test("a failed gate stops immediately and preserves its output", () => {
  const { root, result, calls } = run("linux", "run lint");
  expect(result.status).toBe(37);
  expect(calls.at(-1)).toContain("run lint");
  expect(readFileSync(join(root, "artifacts/ci/lint.log"), "utf8")).toContain("intentional-failure");
});

test("macOS lane runs only its device-free source and Live checks", () => {
  const { root, result, calls } = run("macos");
  expect(result.status).toBe(0);
  expect(calls.map((line) => line.split("|")[2])).toEqual([
    "install --frozen-lockfile",
    "run prepare:assets",
    "scripts/offline-openai-default-transport.ts --source-only",
    "test tests/live-*.test.ts",
  ]);
  expect(readFileSync(join(root, "artifacts/ci/macos-live-tests.log"), "utf8")).toContain("completed");
});
