import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateReleaseTag } from "../scripts/validate-release-tag";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => Bun.file(resolve(root, path)).text();

describe("release automation", () => {
  test("CI is deterministic, locked, credential-free, and retains failure logs", async () => {
    const workflow = await read(".github/workflows/ci.yml");
    expect(() => Bun.YAML.parse(workflow)).not.toThrow();
    expect(workflow).toContain("bun-version: 1.4.1");
    expect(workflow).toContain("apt-get install -y tmux");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run lint");
    expect(workflow).toContain("bun run check");
    expect(workflow).toContain("bun run build");
    expect(workflow).toContain("DIE_RUN_LLM_TESTS: \"0\"");
    expect(workflow).toContain("bun test ./tests");
    expect(workflow).toContain("bun run smoke");
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).not.toContain("DIE_RUN_LLM_TESTS: \"1\"");
    expect(workflow).not.toMatch(/API_KEY|AUTH_TOKEN/);
  });

  test("tag release is version-gated and limited to Linux x64", async () => {
    const workflow = await read(".github/workflows/release.yml");
    expect(() => Bun.YAML.parse(workflow)).not.toThrow();
    expect(workflow).toContain('- "v*"');
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain('validate-release-tag.ts "$GITHUB_REF_NAME"');
    expect(workflow).toContain("apt-get install -y tmux");
    expect(workflow).toContain("bun run lint");
    expect(workflow.indexOf("bun run build")).toBeLessThan(workflow.indexOf("bun test ./tests"));
    expect(workflow).toContain("--target=bun-linux-x64-baseline");
    expect(workflow).toContain('test "$(./dist/release/die-linux-x64 --version)" = "${GITHUB_REF_NAME#v}"');
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("die-linux-x64.sha256");
    expect(workflow).toContain("THIRD_PARTY_NOTICES.md");
    expect(workflow).toContain("bun run generate:notices");
    expect(workflow).toContain("THIRD_PARTY_LICENSES.txt");
    expect(workflow).toContain("SOURCE.txt");
    expect(workflow).not.toMatch(/bun-(darwin|windows|linux-arm)/);
  });

  test("release validator handles mismatch and prerelease versions without a real tag", () => {
    expect(validateReleaseTag("v2.3.4-beta.1", "2.3.4-beta.1")).toBeUndefined();
    expect(validateReleaseTag("v2.3.4", "2.3.5")).toContain("does not match package.json version");
    expect(validateReleaseTag("v2.3.4", "not-semver")).toContain("unsupported version");
  });

  test("CLI release validator derives the expected tag from package.json", async () => {
    const pkg = await Bun.file(resolve(root, "package.json")).json() as { version: string };
    const run = (tag: string) => Bun.spawnSync({
      cmd: [process.execPath, "scripts/validate-release-tag.ts", tag], cwd: root, stdout: "pipe", stderr: "pipe",
    });
    expect(run("v" + pkg.version).exitCode).toBe(0);
    expect(run("v999.0.0").stderr.toString()).toContain("does not match package.json version");
  });

  test("generated attribution bundle contains full Pi and Bun license notices", async () => {
    const directory = await mkdtemp(join(tmpdir(), "die-notices-"));
    const output = join(directory, "THIRD_PARTY_LICENSES.txt");
    try {
      const result = Bun.spawnSync({ cmd: [process.execPath, "scripts/generate-third-party-notices.ts", output], cwd: root, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const notices = await Bun.file(output).text();
      expect(notices).toContain("@earendil-works/pi-coding-agent@0.85.0");
      expect(notices).toContain("PI UPSTREAM LICENSE");
      expect(notices).toContain("Copyright (c) 2025 Mario Zechner");
      expect(notices).toContain("Permission is hereby granted, free of charge");
      expect(notices).toContain("BUN RUNTIME UPSTREAM LICENSING");
      expect(notices).toContain("JavaScriptCore");
      expect(notices.length).toBeGreaterThan(100_000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("embedded vendor license banners are preserved", async () => {
    const highlight = await read("node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/vendor/highlight.min.js");
    const marked = await read("node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/vendor/marked.min.js");
    expect(highlight.slice(0, 250)).toContain("License: BSD-3-Clause");
    expect(marked.slice(0, 300)).toContain("MIT License");
  });
});
