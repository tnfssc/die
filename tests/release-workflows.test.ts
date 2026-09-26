import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateThirdPartyNotices } from "../scripts/generate-third-party-notices";
import { validateReleaseTag } from "../scripts/validate-release-tag";
import { selectReleaseNotes } from "../scripts/select-release-notes";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => Bun.file(resolve(root, path)).text();

type FixturePackage = { manifest: Record<string, unknown>; license?: string };

async function writeNoticeFixture(
  directory: string,
  dependencies: string[],
  packages: Record<string, FixturePackage>,
): Promise<void> {
  await mkdir(join(directory, "third_party/pi"), { recursive: true });
  await mkdir(join(directory, "third_party/bun"), { recursive: true });
  await Bun.write(
    join(directory, "package.json"),
    JSON.stringify({ dependencies: Object.fromEntries(dependencies.map((name) => [name, "1.0.0"])) }),
  );
  await Bun.write(join(directory, "third_party/pi/LICENSE"), "Pi license\n");
  await Bun.write(join(directory, "third_party/bun/LICENSE.md"), "Bun license\n");
  for (const [name, fixture] of Object.entries(packages)) {
    const packageDirectory = join(directory, "node_modules", name);
    await mkdir(packageDirectory, { recursive: true });
    await Bun.write(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name, version: "1.0.0", ...fixture.manifest }),
    );
    if (fixture.license !== undefined) await Bun.write(join(packageDirectory, "LICENSE"), fixture.license);
  }
}

describe("release automation", () => {
  test("native Live CI has no legacy SoX or candidate bundle path", async () => {
    const ci = await read(".github/workflows/ci.yml");
    const native = await read(".github/workflows/live.yml");
    expect(ci).not.toContain("brew install sox");
    expect(ci).toContain("bun run ci:macos");
    expect(await read("scripts/ci.sh")).toContain("bun test tests/live-*.test.ts");
    expect(native).not.toContain("inputs.bundle");
    expect(native).not.toContain("live-candidate");
  });
  test("all workflow actions use audited immutable commits and tool versions stay aligned", async () => {
    const pins = new Map([
      ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
      ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
      ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
      ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
      ["pnpm/action-setup", "ea17c68df8912ef543352723c149a84f56e3d413"],
      ["oven-sh/setup-bun", "0c5077e51419868618aeaa5fe8019c62421857d6"],
    ]);
    for (const path of ["ci", "live", "release"]) {
      const workflow = Bun.YAML.parse(await read(`.github/workflows/${path}.yml`)) as {
        permissions?: Record<string, string>;
        jobs: Record<
          string,
          { permissions?: Record<string, string>; steps: { uses?: string; with?: Record<string, unknown> }[] }
        >;
      };
      expect(workflow.permissions).toEqual({ contents: "read" });
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (jobName === "publish" || jobName === "prepare-manual")
          expect(job.permissions).toEqual({ contents: "write" });
        else expect(job.permissions?.contents).not.toBe("write");
        for (const step of job.steps) {
          if (!step.uses) continue;
          const [repo, sha] = step.uses.split("@");
          expect(pins.has(repo!)).toBe(true);
          expect(sha!).toMatch(/^[a-f0-9]{40}$/);
          expect(sha!).toBe(pins.get(repo!)!);
          if (repo === "actions/setup-node") expect(step.with?.["node-version"]).toBe("24.21.0");
          if (repo === "pnpm/action-setup") expect(step.with?.version).toBe("11.27.1");
          if (repo === "oven-sh/setup-bun") expect(step.with?.["bun-version"]).toBe("1.4.2");
        }
      }
    }
    expect(await read("mise.toml")).toContain('bun = "1.4.2"');
    const notices = await read("scripts/generate-third-party-notices.ts");
    expect(notices).toContain("Bun 1.4.2 runtime");
    expect(notices).toContain("oven-sh/bun/tree/bun-v1.4.2");
  });

  test("CI is deterministic, locked, credential-free, and retains failure logs", async () => {
    const workflow = await read(".github/workflows/ci.yml");
    expect(() => Bun.YAML.parse(workflow)).not.toThrow();
    expect(workflow).toContain("bun-version: 1.4.2");
    expect(workflow).toContain("pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413");
    expect(workflow).toContain("version: 11.27.1");
    expect(workflow).toContain("apt-get install -y tmux");
    expect(workflow).toContain("run: bun run ci");
    const runner = await read("scripts/ci.sh");
    expect(runner).toContain("bun install --frozen-lockfile");
    expect(runner).toContain("bun run lint");
    expect(runner).toContain("bun run check");
    expect(runner).toContain("bun run build");
    expect(runner).toContain("env DIE_RUN_LLM_TESTS=0 bun test ./tests");
    expect(runner).toContain("bun run smoke");
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(workflow).not.toContain('DIE_RUN_LLM_TESTS: "1"');
    expect(workflow).not.toMatch(/API_KEY|AUTH_TOKEN/);
  });

  test("macOS Live CI checks native runtime without opening devices or using credentials", async () => {
    const workflow = Bun.YAML.parse(await read(".github/workflows/ci.yml")) as {
      jobs: Record<string, { "runs-on": string; steps: { run?: string }[] }>;
    };
    const job = workflow.jobs["live-macos"]!;
    expect(job["runs-on"]).toBe("macos-15");
    const commands = job.steps.map((step) => step.run ?? "").join("\n");
    expect(commands).toContain("brew install tmux");
    expect(commands).toContain("bun run ci:macos");
    const runner = await read("scripts/ci.sh");
    const lane = runner.split('if [[ "$lane" == macos ]]; then')[1]!.split("\nfi")[0]!;
    expect(lane).toContain("bun run prepare:assets");
    expect(lane).toContain("bun test tests/live-*.test.ts");
    expect(lane).not.toMatch(/API_KEY|live.env|SoxAudioAdapter|\b(rec|play) /);
    expect(commands).not.toContain("sox");
    expect(commands).not.toContain("checkAudioCapabilities");
    expect(commands).not.toContain("acceptance");
    expect(commands).not.toMatch(/API_KEY|live.env|SoxAudioAdapter|\b(rec|play) /);
  });

  test("tag release is version-gated and builds Linux x64/arm64, macOS arm64, and Android binaries", async () => {
    const workflow = await read(".github/workflows/release.yml");
    expect(() => Bun.YAML.parse(workflow)).not.toThrow();
    expect(workflow).toContain('- "v*"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("!contains(github.ref_name, '-')");
    expect(workflow).toContain("needs: [reuse-check, prepare-manual, mac-helper]");
    expect(workflow).toContain("scripts/build-live-helper.sh");
    expect(workflow).toContain("Mach-O 64-bit (executable arm64|arm64 executable)");
    expect(workflow).toContain("-fsanitize=address,undefined");
    expect(workflow).toContain("actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c");
    expect(workflow).toContain("--live-helper=./artifacts/release/mac-helper/live-audio");
    expect(workflow).toContain("stable-release-assets");
    expect(workflow).toContain("needs: [release, reuse-assets, mac-release-smoke, prepare-manual]");
    expect(workflow).toContain("bun scripts/verify-v071-update.ts dist/release/die-darwin-arm64");
    expect(workflow).toContain("--live-self-test");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain('validate-release-tag.ts "$tag"');
    expect(workflow).toContain("apt-get install -y tmux");
    expect(workflow).toContain("bun run lint");
    expect(workflow.indexOf("bun run build")).toBeLessThan(workflow.indexOf("bun test ./tests"));
    expect(workflow).toContain("--target=bun-linux-x64-baseline");
    expect(workflow).toContain("--target=bun-linux-arm64");
    expect(workflow).toContain("--target=bun-darwin-arm64");
    expect(workflow).toContain("--target=bun-android-arm64");
    expect(workflow).toContain('test "$(./dist/release/die-linux-x64 --version)" = "$(bun -p');
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("die-linux-x64.sha256");
    expect(workflow).toContain("die-linux-arm64.sha256");
    expect(workflow).toContain("die-darwin-arm64.sha256");
    expect(workflow).toContain("die-android-arm64.sha256");
    expect(workflow).toContain("THIRD_PARTY_NOTICES.md");
    expect(workflow).toContain("bun run generate:notices");
    expect(workflow).toContain("THIRD_PARTY_LICENSES.txt");
    expect(workflow).toContain("EMBEDDED T3 CODE BACKEND LICENSING");
    expect(workflow).toContain("src/terminal/BunPtyAdapter.test.ts");
    expect(workflow).toContain("dist/die-web/LICENSE-T3CODE");
    expect(workflow).toContain("SOURCE.txt");
    expect(workflow).toContain("Embedded T3 Code source:");
    expect(workflow).toContain("Patch-SHA256:");
    expect(workflow).toContain(
      "bun run build -- --reuse-web --target=bun-linux-x64-baseline --outfile=./dist/release/die-linux-x64",
    );
    expect(workflow).toContain(
      "bun run build -- --reuse-web --target=bun-linux-arm64 --outfile=./dist/release/die-linux-arm64",
    );
    expect(workflow).toContain(
      "bun run build -- --reuse-web --live-helper=./artifacts/release/mac-helper/live-audio --target=bun-darwin-arm64 --outfile=./dist/release/die-darwin-arm64",
    );
    expect(workflow).toContain(
      "bun run build -- --reuse-web --target=bun-android-arm64 --outfile=./dist/release/die-android-arm64",
    );
    expect(workflow).not.toContain("die-web-linux-x64.tar.gz");
    expect(workflow).not.toContain("Package web sidecar");
    expect(workflow).not.toMatch(/bun-(windows|darwin-x64|linux-arm32)/);
  });

  test("stable publication waits for actual Mac payload gates and retains raw assets", async () => {
    const workflow = Bun.YAML.parse(await read(".github/workflows/release.yml")) as {
      on: Record<string, unknown>;
      jobs: Record<
        string,
        { if?: string; needs?: string | string[]; permissions?: Record<string, string>; steps: { run?: string }[] }
      >;
    };
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch", "push"]);
    expect(workflow.on.push).toEqual({ branches: ["develop"], tags: ["v*"] });
    expect(workflow.jobs.publish!.if).toBe(
      "${{ always() && (github.event_name == 'workflow_dispatch' && needs.prepare-manual.result == 'success' || github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')) && needs.mac-release-smoke.result == 'success' && (needs.release.result == 'success' || needs.reuse-assets.result == 'success') }}",
    );
    expect(workflow.jobs.publish!.needs).toEqual(["release", "reuse-assets", "mac-release-smoke", "prepare-manual"]);
    expect(workflow.jobs["mac-release-smoke"]!.needs).toEqual(["release", "reuse-assets", "prepare-manual"]);
    expect(workflow.jobs["mac-release-smoke"]!.if).toContain(
      "needs.release.result == 'success' || needs.reuse-assets.result == 'success'",
    );
    expect(workflow.jobs.release!.permissions?.contents).not.toBe("write");
    expect(workflow.jobs.publish!.permissions?.contents).toBe("write");
    const macCommands = workflow.jobs["mac-release-smoke"]!.steps.map((step) => step.run ?? "").join("\n");
    expect(macCommands).toContain("verify-v071-update.ts");
    expect(macCommands).toContain("--live-self-test");
    expect(macCommands).not.toContain('"type":"start"');
  });

  test("release validator handles mismatch and prerelease versions without a real tag", () => {
    expect(validateReleaseTag("v2.3.4-beta.1", "2.3.4-beta.1")).toBeUndefined();
    expect(validateReleaseTag("v2.3.4", "2.3.5")).toContain("does not match package.json version");
    expect(validateReleaseTag("v2.3.4", "not-semver")).toContain("unsupported version");
  });

  test("publish selects only notes for the validated tag and fails closed", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const publish = workflow.slice(workflow.indexOf("  publish:"));
    expect(publish).toContain('notes_file=$(bun scripts/select-release-notes.ts "$RELEASE_TAG")');
    expect(publish).toContain('--notes-file "$notes_file"');
    expect(publish).not.toContain("--notes-file support/release-v0.11.1.md");
    expect(publish.indexOf("notes_file=$(bun")).toBeLessThan(publish.indexOf("gh release create"));
    const directory = await mkdtemp(join(tmpdir(), "die-release-notes-"));
    try {
      await mkdir(join(directory, "support"));
      await Bun.write(join(directory, "support/release-v9.8.7.md"), "current release\n");
      await Bun.write(join(directory, "support/release-v0.11.1.md"), "stale release\n");
      expect(await selectReleaseNotes("v9.8.7", "9.8.7", directory)).toBe(join(directory, "support/release-v9.8.7.md"));
      await expect(selectReleaseNotes("v9.8.8", "9.8.7", directory)).rejects.toThrow("does not match");
      await expect(selectReleaseNotes("v9.8.6", "9.8.6", directory)).rejects.toThrow("Missing or empty release notes");
      await Bun.write(join(directory, "support/release-v9.8.6.md"), "");
      await expect(selectReleaseNotes("v9.8.6", "9.8.6", directory)).rejects.toThrow("Missing or empty release notes");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("CLI release validator derives the expected tag from package.json", async () => {
    const pkg = (await Bun.file(resolve(root, "package.json")).json()) as { version: string };
    const run = (tag: string) =>
      Bun.spawnSync({
        cmd: [process.execPath, "scripts/validate-release-tag.ts", tag],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
    expect(run("v" + pkg.version).exitCode).toBe(0);
    expect(run("v999.0.0").stderr.toString()).toContain("does not match package.json version");
  });

  test("generated attribution bundle contains full Pi and Bun license notices", async () => {
    const directory = await mkdtemp(join(tmpdir(), "die-notices-"));
    const output = join(directory, "THIRD_PARTY_LICENSES.txt");
    try {
      const result = Bun.spawnSync({
        cmd: [process.execPath, "scripts/generate-third-party-notices.ts", output],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const notices = await Bun.file(output).text();
      expect(notices).toContain("@earendil-works/pi-coding-agent@0.87.1");
      expect(notices).toContain("proxy-agent-negotiate@1.1.0");
      expect(notices).toContain("Nathan Rajlich");
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

  test("attribution generation fails when a required transitive dependency is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "die-notices-required-"));
    try {
      await writeNoticeFixture(directory, ["present"], {
        present: { manifest: { dependencies: { missing: "1.0.0" } }, license: "MIT\n" },
      });
      await expect(generateThirdPartyNotices(directory, join(directory, "notices.txt"))).rejects.toThrow(
        "production dependency missing could not be resolved",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("Pi fallback fails closed for unknown packages and unpinned versions", async () => {
    for (const [name, version] of [
      ["@earendil-works/not-pi", "0.87.1"],
      ["@earendil-works/pi-ai", "0.85.1"],
    ]) {
      const directory = await mkdtemp(join(tmpdir(), "die-notices-fallback-"));
      try {
        await writeNoticeFixture(directory, [name], { [name]: { manifest: { version } } });
        await expect(generateThirdPartyNotices(directory, join(directory, "notices.txt"))).rejects.toThrow(
          `${name}@${version} has no packaged or curated LICENSE`,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test("license input budget is checked before an oversized file is read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "die-notices-budget-"));
    try {
      await writeNoticeFixture(directory, ["large-license"], {
        "large-license": { manifest: {}, license: "x".repeat(512) },
      });
      await expect(generateThirdPartyNotices(directory, join(directory, "notices.txt"), 128)).rejects.toThrow(
        /byte budget before reading .*LICENSE/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("embedded vendor license banners are preserved", async () => {
    const highlight = await read(
      "node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/vendor/highlight.min.js",
    );
    const marked = await read(
      "node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/vendor/marked.min.js",
    );
    expect(highlight.slice(0, 250)).toContain("License: BSD-3-Clause");
    expect(marked.slice(0, 300)).toContain("MIT License");
  });
});
