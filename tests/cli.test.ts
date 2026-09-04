import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

const root = resolve(import.meta.dir, "..");
const binary = join(root, "dist/die");
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "die-cli-test-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function isolatedEnv(): Record<string, string> {
  return { HOME: home, PATH: "/nonexistent" };
}

describe("compiled die CLI", () => {
  test("is standalone and reports the product version", async () => {
    const result = await run([binary, "--version"], { env: isolatedEnv() });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  test("exposes branded help and uses ~/.die instead of ~/.pi", async () => {
    const result = await run([binary, "--help"], { env: isolatedEnv() });

    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith("die - AI coding assistant");
    expect(result.stdout).not.toContain("bash, edit, write tools");
    expect(result.stdout).not.toContain("--no-tools");
    expect(result.stdout).not.toContain("--no-builtin-tools");
    expect(result.stdout).not.toContain("--exclude-tools");
    expect(result.stdout).not.toContain("--tools,");
    expect(result.stdout).not.toContain(" update [source|self|pi]");
    expect(await Bun.file(join(home, ".die", "runtime", "0.1.0", "package.json")).exists()).toBe(true);
    expect(await Bun.file(join(home, ".pi", "agent", "settings.json")).exists()).toBe(false);
  });

  test("does not rewrite materialized runtime assets on later launches", async () => {
    const runtime = join(home, ".die", "runtime", "0.1.0");
    expect((await run([binary, "--version"], { env: isolatedEnv() })).code).toBe(0);
    const files = (await readdir(runtime, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    const before = await Promise.all(files.map(async (file) => [file, (await stat(file)).mtimeMs] as const));

    await Bun.sleep(20);
    expect((await run([binary, "--version"], { env: isolatedEnv() })).code).toBe(0);
    const after = await Promise.all(before.map(async ([file]) => (await stat(file)).mtimeMs));

    expect(after).toEqual(before.map(([, mtime]) => mtime));
  });

  test("rejects removed generic tool-selection options", async () => {
    for (const option of ["--no-tools", "--no-builtin-tools", "--tools=read", "--exclude-tools=bash"]) {
      const result = await run([binary, option], { env: isolatedEnv() });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("is not supported by die");
    }
  });

  test("disables self-update until die has an update channel", async () => {
    const result = await run([binary, "update"], { env: isolatedEnv() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("die updates are disabled");
  });

  test("installs atomically into the requested local bin directory", async () => {
    const installDir = join(home, ".local", "bin");
    const result = await run([join(root, "scripts/install-local.sh")], {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        DIE_INSTALL_DIR: installDir,
        DIE_SKIP_BUILD: "1",
      },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Installed die to ${join(installDir, "die")}`);
    const installed = await run([join(installDir, "die"), "--version"], { env: isolatedEnv() });
    expect(installed.code).toBe(0);
    expect(installed.stdout.trim()).toBe("0.1.0");
  });
});
