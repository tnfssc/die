import { expect, test } from "bun:test";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractWebArchive, packWebArchive } from "../../src/t3/web/archive";

test("all web builders copy the maintained bootstrap to the same packaged filename", async () => {
  const root = resolve(import.meta.dir, "../..");
  expect(await Bun.file(join(root, "integrations/t3/upstream/bootstrap.mjs")).exists()).toBe(true);
  for (const script of ["integrations/t3/build/build.ts", "scripts/build.ts"]) {
    const contents = await Bun.file(join(root, script)).text();
    expect(contents).toContain("integrations/t3/upstream/bootstrap.mjs");
    expect(contents).toContain("bootstrap.mjs");
    expect(contents).not.toContain("support/die-web-bootstrap.mjs");
  }
});

test("web archive is deterministic and extracts privately by content hash", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "die-web-runtime-"));
  try {
    const source = join(temporary, "source");
    await mkdir(join(source, "dist"), { recursive: true });
    await writeFile(join(source, "dist", "bin.mjs"), "export const value = 1;\n");
    await chmod(join(source, "dist", "bin.mjs"), 0o755);
    await symlink("dist/bin.mjs", join(source, "entry"));
    const first = join(temporary, "first.gz");
    const second = join(temporary, "second.gz");
    const firstHash = await packWebArchive(source, first);
    const secondHash = await packWebArchive(source, second);
    expect(secondHash).toBe(firstHash);
    expect(await readFile(second)).toEqual(await readFile(first));

    const cache = join(temporary, "cache");
    const root = await extractWebArchive(await Bun.file(first).bytes(), cache);
    expect(root.endsWith(firstHash)).toBe(true);
    expect(await readFile(join(root, "dist", "bin.mjs"), "utf8")).toBe("export const value = 1;\n");
    expect(await readlink(join(root, "entry"))).toBe("dist/bin.mjs");
    expect((await lstat(cache)).mode & 0o777).toBe(0o700);
    expect((await lstat(join(root, "dist", "bin.mjs"))).mode & 0o777).toBe(0o700);
    expect(await extractWebArchive(await Bun.file(first).bytes(), cache)).toBe(root);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("web archive rejects corrupt payloads without publishing an extraction", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "die-web-corrupt-"));
  try {
    await expect(extractWebArchive(new Uint8Array([1, 2, 3]), join(temporary, "cache"))).rejects.toThrow();
    expect((await Array.fromAsync(new Bun.Glob("**/*").scan(join(temporary, "cache")))).length).toBe(0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("concurrent web extraction publishes one complete runtime and cleans staging", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "die-web-concurrent-"));
  try {
    const source = join(temporary, "source");
    await mkdir(source);
    await writeFile(join(source, "file"), "payload");
    const archive = join(temporary, "payload.gz");
    const hash = await packWebArchive(source, archive);
    const bytes = await Bun.file(archive).bytes();
    const cache = join(temporary, "cache");
    const roots = await Promise.all(Array.from({ length: 8 }, () => extractWebArchive(bytes, cache)));
    expect(new Set(roots).size).toBe(1);
    expect(await readFile(join(roots[0], "file"), "utf8")).toBe("payload");
    expect(await readFile(join(roots[0], ".complete"), "utf8")).toBe(hash + "\n");
    expect(await Array.fromAsync(new Bun.Glob(".*.tmp").scan(cache))).toEqual([]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("web extraction refuses a symlinked content-addressed target", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "die-web-symlink-"));
  try {
    const source = join(temporary, "source");
    const cache = join(temporary, "cache");
    await mkdir(source);
    await mkdir(cache);
    await writeFile(join(source, "file"), "payload");
    const archive = join(temporary, "payload.gz");
    const hash = await packWebArchive(source, archive);
    await symlink(source, join(cache, hash));
    await expect(extractWebArchive(await Bun.file(archive).bytes(), cache)).rejects.toThrow("not a directory");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("standalone executable opens embedded web CLI without Node, Bun, or sidecar on PATH", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "die-web-standalone-"));
  try {
    const sourceBinary = resolve(process.env.DIE_WEB_BINARY ?? resolve(import.meta.dir, "../../dist/die"));
    const binary = join(temporary, "die");
    await copyFile(sourceBinary, binary);
    await chmod(binary, 0o700);
    const child = Bun.spawn([binary, "web", "--help"], {
      cwd: temporary,
      env: { HOME: temporary, TMPDIR: temporary, PATH: "/nonexistent", HERDR_ENV: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 60000);
    let code: number;
    let stdout: string;
    let stderr: string;
    try {
      [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }
    if (code! !== 0) throw new Error(`Standalone web help exited ${code!}: ${stderr!}\n${stdout!}`);
    expect(code!).toBe(0);
    expect(stdout!).toContain("Run the T3 Code server");
    const markers = await Array.fromAsync(new Bun.Glob("*/.complete").scan(join(temporary, ".cache/die/web-runtime")));
    expect(markers).toHaveLength(1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 65000);
