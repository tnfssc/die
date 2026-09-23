import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateThirdPartyNotices } from "../scripts/generate-third-party-notices";
import { validateReleaseTag } from "../scripts/validate-release-tag";

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
  test("CI is deterministic, locked, credential-free, and retains failure logs", async () => {
    const workflow = await read(".github/workflows/ci.yml");
    expect(() => Bun.YAML.parse(workflow)).not.toThrow();
    expect(workflow).toContain("bun-version: 1.4.1");
    expect(workflow).toContain("pnpm/action-setup@v4");
    expect(workflow).toContain("version: 11.10.0");
    expect(workflow).toContain("apt-get install -y tmux");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run lint");
    expect(workflow).toContain("bun run check");
    expect(workflow).toContain("bun run build");
    expect(workflow).toContain('DIE_RUN_LLM_TESTS: "0"');
    expect(workflow).toContain("bun test ./tests");
    expect(workflow).toContain("bun run smoke");
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).not.toContain('DIE_RUN_LLM_TESTS: "1"');
    expect(workflow).not.toMatch(/API_KEY|AUTH_TOKEN/);
  });

  test("macOS Live CI checks Homebrew CoreAudio without opening devices or using credentials", async () => {
    const workflow = Bun.YAML.parse(await read(".github/workflows/ci.yml")) as {
      jobs: Record<string, { "runs-on": string; steps: { run?: string }[] }>;
    };
    const job = workflow.jobs["live-macos"]!;
    expect(job["runs-on"]).toBe("macos-15");
    const commands = job.steps.map((step) => step.run ?? "").join("\n");
    expect(commands).toContain("brew install sox");
    expect(commands).toContain("sox --help | grep -w coreaudio");
    expect(commands).toContain("checkAudioCapabilities()");
    expect(commands).toContain("tests/audio.test.ts tests/live-setup.test.ts");
    expect(commands).not.toContain("acceptance");
    expect(commands).not.toMatch(/API_KEY|live.env|SoxAudioAdapter|\b(rec|play) /);
  });

  test("tag release is version-gated and builds Linux x64/arm64, macOS arm64, and Android binaries", async () => {
    const workflow = await read(".github/workflows/release.yml");
    expect(() => Bun.YAML.parse(workflow)).not.toThrow();
    expect(workflow).toContain('- "v*"');
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(workflow).toContain("!contains(github.ref_name, '-')");
    expect(workflow).toContain("needs: mac-helper");
    expect(workflow).toContain("scripts/build-live-lab-helper.sh");
    expect(workflow).toContain("-fsanitize=address,undefined");
    expect(workflow).toContain("actions/download-artifact@v4");
    expect(workflow).toContain("--live-lab-helper=./artifacts/release/mac-helper/live-lab-audio");
    expect(workflow).toContain("stable-release-assets");
    expect(workflow).toContain("needs: [release, mac-release-smoke]");
    expect(workflow).toContain("bun scripts/verify-v071-update.ts dist/release/die-darwin-arm64");
    expect(workflow).toContain("--live-lab-self-test");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain('validate-release-tag.ts "$GITHUB_REF_NAME"');
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
      "bun run build -- --reuse-web --live-lab-helper=./artifacts/release/mac-helper/live-lab-audio --target=bun-darwin-arm64 --outfile=./dist/release/die-darwin-arm64",
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
        { needs?: string | string[]; permissions?: Record<string, string>; steps: { run?: string }[] }
      >;
    };
    expect(Object.keys(workflow.on)).toEqual(["push"]);
    expect(workflow.jobs.publish!.needs).toEqual(["release", "mac-release-smoke"]);
    expect(workflow.jobs["mac-release-smoke"]!.needs).toBe("release");
    expect(workflow.jobs.release!.permissions?.contents).not.toBe("write");
    expect(workflow.jobs.publish!.permissions?.contents).toBe("write");
    const macCommands = workflow.jobs["mac-release-smoke"]!.steps.map((step) => step.run ?? "").join("\n");
    expect(macCommands).toContain("verify-v071-update.ts");
    expect(macCommands).toContain("--live-lab-self-test");
    expect(macCommands).not.toContain('"type":"start"');
  });

  test("release validator handles mismatch and prerelease versions without a real tag", () => {
    expect(validateReleaseTag("v2.3.4-beta.1", "2.3.4-beta.1")).toBeUndefined();
    expect(validateReleaseTag("v2.3.4", "2.3.5")).toContain("does not match package.json version");
    expect(validateReleaseTag("v2.3.4", "not-semver")).toContain("unsupported version");
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
