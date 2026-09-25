import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("macOS Live CI builds the CLI before execute-control tests", () => {
  const workflow = readFileSync(resolve(import.meta.dir, "../.github/workflows/ci.yml"), "utf8");
  const macOSJob = workflow.split("  live-macos:\n")[1]?.split(/^ {2}[a-z][\w-]*:\s*$/m)[0];
  expect(macOSJob).toBeDefined();
  const build = macOSJob!.indexOf("      - run: bun run build\n");
  const tests = macOSJob!.indexOf("        run: bun test tests/live-*.test.ts");
  expect(build).toBeGreaterThanOrEqual(0);
  expect(tests).toBeGreaterThan(build);
});
