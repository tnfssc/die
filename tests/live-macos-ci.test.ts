import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("macOS Live CI prepares source CLI assets without building the web runtime", () => {
  const workflow = readFileSync(resolve(import.meta.dir, "../.github/workflows/ci.yml"), "utf8");
  const macOSJob = workflow.split("  live-macos:\n")[1]?.split(/^ {2}[a-z][\w-]*:\s*$/m)[0];
  expect(macOSJob).toBeDefined();
  expect(macOSJob).toContain("run: bun run ci:macos");
  const runner = readFileSync(resolve(import.meta.dir, "../scripts/ci.sh"), "utf8");
  const lane = runner.split('if [[ "$lane" == macos ]]; then')[1]!.split("\nfi")[0]!;
  const prepare = lane.indexOf("bun run prepare:assets");
  expect(lane).not.toContain("bun run build");
  expect(macOSJob).not.toContain("--reuse-web");
  const tests = lane.indexOf("bun test tests/live-*.test.ts");
  expect(prepare).toBeGreaterThanOrEqual(0);
  expect(tests).toBeGreaterThan(prepare);
  const fixture = readFileSync(resolve(import.meta.dir, "live-execute-controls.test.ts"), "utf8");
  expect(fixture).toContain("fixtures/live-execute-cli.sh");
  const integration = readFileSync(resolve(import.meta.dir, "live-main-integration.test.ts"), "utf8");
  expect(integration).toContain("existsSync(compiled)");
  expect(integration).toContain("fixtures/live-execute-cli.sh");
  const wrapper = readFileSync(resolve(import.meta.dir, "fixtures/live-execute-cli.sh"), "utf8");
  expect(wrapper).toContain("src/cli.ts");
  expect(wrapper).toContain('"$@"');
});
