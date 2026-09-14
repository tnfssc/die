import { chmod, cp, mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
const installer = join(import.meta.dir, "..", "scripts/install-local.sh");
async function sandbox(web = true) {
  const root = await mkdtemp(join(tmpdir(), "die-install-"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "dist"));
  await cp(installer, join(root, "scripts/install-local.sh"));
  await chmod(join(root, "scripts/install-local.sh"), 0o755);
  await writeFile(join(root, "dist/die"), "cli", { mode: 0o755 });
  if (web) {
    await mkdir(join(root, "dist/die-web/assets"), { recursive: true });
    await writeFile(join(root, "dist/die-web/index.html"), "web");
    await writeFile(join(root, "dist/die-web/assets/app.js"), "app");
  }
  return root;
}
async function run(root: string, bin: string, extra: Record<string, string> = {}) {
  const proc = Bun.spawn(["sh", join(root, "scripts/install-local.sh")], {
    cwd: root,
    env: { ...process.env, HOME: join(root, "home"), DIE_INSTALL_DIR: bin, DIE_SKIP_BUILD: "1", ...extra },
    stdout: "ignore",
    stderr: "ignore",
  });
  return proc.exited;
}
describe("local installer web sidecar", () => {
  test("installs CLI and complete sidecar", async () => {
    const r = await sandbox();
    const b = join(r, "bin");
    expect(await run(r, b)).toBe(0);
    expect(await readFile(join(b, "die"), "utf8")).toBe("cli");
    expect(await readFile(join(b, "die-web/assets/app.js"), "utf8")).toBe("app");
  });
  test("replaces an existing sidecar", async () => {
    const r = await sandbox();
    const b = join(r, "bin");
    await run(r, b);
    await writeFile(join(r, "dist/die-web/index.html"), "replacement");
    expect(await run(r, b)).toBe(0);
    expect(await readFile(join(b, "die-web/index.html"), "utf8")).toBe("replacement");
    expect((await readdir(b)).filter((n) => n.includes("install-") || n.includes("backup-")).length).toBe(0);
  });
  test("keeps CLI-only behavior without sidecar", async () => {
    const r = await sandbox(false);
    const b = join(r, "bin");
    expect(await run(r, b)).toBe(0);
    expect(await readdir(b)).toEqual(["die"]);
  });
  test("preserves sidecar when staging fails", async () => {
    const r = await sandbox();
    const b = join(r, "bin");
    await run(r, b);
    await writeFile(join(r, "dist/die-web/index.html"), "broken");
    const fail = join(r, "fail-bin");
    await mkdir(fail);
    await writeFile(join(fail, "cp"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    expect(await run(r, b, { PATH: fail + ":" + process.env.PATH })).not.toBe(0);
    expect(await readFile(join(b, "die-web/index.html"), "utf8")).toBe("web");
  });
});
