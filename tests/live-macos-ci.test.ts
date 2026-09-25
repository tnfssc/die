import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("macOS Live CI prepares source CLI assets without building the web runtime", () => {
  const workflow = readFileSync(resolve(import.meta.dir, "../.github/workflows/ci.yml"), "utf8");
  const macOSJob = workflow.split("  live-macos:\n")[1]?.split(/^ {2}[a-z][\w-]*:\s*$/m)[0];
  expect(macOSJob).toBeDefined();
  const prepare = macOSJob!.indexOf("      - run: bun run prepare:assets\n");
  expect(macOSJob).not.toContain("bun run build");
  expect(macOSJob).not.toContain("--reuse-web");
  const tests = macOSJob!.indexOf("        run: bun test tests/live-*.test.ts");
  expect(prepare).toBeGreaterThanOrEqual(0);
  expect(tests).toBeGreaterThan(prepare);
  const fixture = readFileSync(resolve(import.meta.dir, "live-execute-controls.test.ts"), "utf8");
  expect(fixture).toContain("fixtures/live-execute-cli.sh");
  const wrapper = readFileSync(resolve(import.meta.dir, "fixtures/live-execute-cli.sh"), "utf8");
  expect(wrapper).toContain("src/cli.ts");
  expect(wrapper).toContain('"$@"');
});
