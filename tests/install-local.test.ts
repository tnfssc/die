import { afterEach, describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installer = join(import.meta.dir, "..", "scripts/install-local.sh");
const roots: string[] = [];
const candidate =
  '#!/bin/sh\necho "$*" >> "$PROBE_LOG"\ncase "$1" in\n--version) exit "${VERSION_STATUS:-0}";;\n--live-self-test) exit "${SELF_TEST_STATUS:-0}";;\n*) exit 99;;\nesac\n';
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "die-install-"));
  roots.push(root);
  for (const dir of ["scripts", "dist", "tools", "bin"]) await mkdir(join(root, dir));
  await cp(installer, join(root, "scripts/install-local.sh"));
  await chmod(join(root, "scripts/install-local.sh"), 0o755);
  await writeFile(join(root, "dist/die"), candidate, { mode: 0o755 });
  await writeFile(
    join(root, "tools/uname"),
    '#!/bin/sh\nif [ "$1" = "-s" ]; then echo "$HOST_OS"; else echo "$HOST_ARCH"; fi\n',
    { mode: 0o755 },
  );
  await writeFile(join(root, "tools/bun"), '#!/bin/sh\necho "bun $*" >> "$BUILD_LOG"\n', { mode: 0o755 });
  await writeFile(join(root, "scripts/build-live-helper.sh"), '#!/bin/sh\necho helper >> "$BUILD_LOG"\n');
  return root;
}

async function run(root: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["sh", join(root, "scripts/install-local.sh")], {
    cwd: root,
    env: {
      ...process.env,
      PATH: join(root, "tools") + ":" + process.env.PATH,
      HOME: join(root, "home"),
      DIE_INSTALL_DIR: join(root, "bin"),
      DIE_SKIP_BUILD: "1",
      HOST_OS: "Linux",
      HOST_ARCH: "x86_64",
      PROBE_LOG: join(root, "probes"),
      BUILD_LOG: join(root, "builds"),
      ...env,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  return proc.exited;
}

describe("local installer", () => {
  test("installs only the verified standalone executable", async () => {
    const root = await sandbox();
    await mkdir(join(root, "dist/die-web/assets"), { recursive: true });
    await writeFile(join(root, "dist/die-web/index.html"), "intermediate web build");
    expect(await run(root)).toBe(0);
    expect(await readFile(join(root, "bin/die"), "utf8")).toBe(candidate);
    expect(await readdir(join(root, "bin"))).toEqual(["die"]);
    expect(await readFile(join(root, "probes"), "utf8")).toBe("--version\n");
    expect(await Bun.file(join(root, "builds")).exists()).toBe(false);
  });

  test("atomically replaces an existing executable without staging leftovers", async () => {
    const root = await sandbox();
    await writeFile(join(root, "bin/die"), "old", { mode: 0o755 });
    expect(await run(root)).toBe(0);
    expect(await readFile(join(root, "bin/die"), "utf8")).toBe(candidate);
    expect(await readdir(join(root, "bin"))).toEqual(["die"]);
  });

  for (const failure of ["VERSION_STATUS", "SELF_TEST_STATUS"])
    test("preserves the installed executable when " + failure + " fails", async () => {
      const root = await sandbox();
      await writeFile(join(root, "bin/die"), "old", { mode: 0o755 });
      expect(await run(root, { HOST_OS: "Darwin", HOST_ARCH: "arm64", [failure]: "1" })).not.toBe(0);
      expect(await readFile(join(root, "bin/die"), "utf8")).toBe("old");
      expect(await readdir(join(root, "bin"))).toEqual(["die"]);
    });

  test("Mac arm64 builds and embeds the helper before validating the candidate", async () => {
    const root = await sandbox();
    expect(await run(root, { DIE_SKIP_BUILD: "0", HOST_OS: "Darwin", HOST_ARCH: "arm64" })).toBe(0);
    expect(await readFile(join(root, "builds"), "utf8")).toBe("helper\nbun run build --live-helper=dist/live-audio\n");
    expect(await readFile(join(root, "probes"), "utf8")).toBe("--version\n--live-self-test\n");
  });

  test("trusted Mac prebuilt skips both builds, not verification", async () => {
    const root = await sandbox();
    expect(await run(root, { HOST_OS: "Darwin", HOST_ARCH: "arm64" })).toBe(0);
    expect(await Bun.file(join(root, "builds")).exists()).toBe(false);
    expect(await readFile(join(root, "probes"), "utf8")).toBe("--version\n--live-self-test\n");
  });

  for (const [os, arch] of [
    ["Linux", "aarch64"],
    ["Darwin", "x86_64"],
  ])
    test(os + " " + arch + " does not build/embed a Mac helper", async () => {
      const root = await sandbox();
      expect(await run(root, { DIE_SKIP_BUILD: "0", HOST_OS: os!, HOST_ARCH: arch! })).toBe(0);
      expect(await readFile(join(root, "builds"), "utf8")).toBe("bun run build\n");
      expect(await readFile(join(root, "probes"), "utf8")).toBe("--version\n");
    });
});
