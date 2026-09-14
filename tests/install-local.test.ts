import { describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installer = join(import.meta.dir, "..", "scripts/install-local.sh");

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "die-install-"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "dist"));
  await cp(installer, join(root, "scripts/install-local.sh"));
  await chmod(join(root, "scripts/install-local.sh"), 0o755);
  await writeFile(join(root, "dist/die"), "cli", { mode: 0o755 });
  return root;
}

async function run(root: string, bin: string) {
  const proc = Bun.spawn(["sh", join(root, "scripts/install-local.sh")], {
    cwd: root,
    env: { ...process.env, HOME: join(root, "home"), DIE_INSTALL_DIR: bin, DIE_SKIP_BUILD: "1" },
    stdout: "ignore",
    stderr: "ignore",
  });
  return proc.exited;
}

describe("local installer", () => {
  test("installs only the standalone executable", async () => {
    const root = await sandbox();
    const bin = join(root, "bin");
    await mkdir(join(root, "dist/die-web/assets"), { recursive: true });
    await writeFile(join(root, "dist/die-web/index.html"), "intermediate web build");

    expect(await run(root, bin)).toBe(0);
    expect(await readFile(join(bin, "die"), "utf8")).toBe("cli");
    expect(await readdir(bin)).toEqual(["die"]);
  });

  test("atomically replaces an existing executable without staging leftovers", async () => {
    const root = await sandbox();
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "die"), "old", { mode: 0o755 });

    expect(await run(root, bin)).toBe(0);
    expect(await readFile(join(bin, "die"), "utf8")).toBe("cli");
    expect((await readdir(bin)).filter((name) => name.includes(".die-install-")).length).toBe(0);
  });
});
