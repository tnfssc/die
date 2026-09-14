import { afterEach, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function packagedBootstrap(entrySource: string) {
  const root = await mkdtemp(join(tmpdir(), "die-web-bootstrap-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "dist"));
  await cp(resolve(import.meta.dir, "../support/die-web-launcher.mjs"), join(root, "launcher.mjs"));
  await cp(resolve(import.meta.dir, "../support/die-web-t3.sh"), join(root, "t3"));
  await chmod(join(root, "t3"), 0o755);
  await writeFile(join(root, "dist", "bin.mjs"), entrySource);
  return root;
}

const cleanEnv = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ...extra,
});

test("packaged bootstrap preserves settings and seeds the local Pi provider", async () => {
  const root = await packagedBootstrap("process.exit(0);\n");
  const baseDir = join(root, "state");
  const settingsPath = join(baseDir, "userdata", "settings.json");
  await mkdir(join(baseDir, "userdata"), { recursive: true });
  await writeFile(
    settingsPath,
    JSON.stringify({
      theme: "dark",
      providers: { pi: { model: "fixture", enabled: false }, other: { token: "keep" } },
      providerInstances: {
        pi: { displayName: "Local Pi", config: { custom: "keep", binaryPath: "/old/pi" } },
        other: { driver: "other", enabled: false, config: { token: "keep" } },
      },
    }),
  );

  const result = await run([join(root, "t3"), "--base-dir", baseDir], {
    env: cleanEnv({ DIE_WEB_DIE_BINARY: join(root, "../die") }),
  });
  expect(result.code).toBe(0);
  expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
    theme: "dark",
    providers: {
      pi: { model: "fixture", enabled: false },
      other: { token: "keep" },
    },
    providerInstances: {
      pi: {
        displayName: "Local Pi",
        driver: "pi",
        enabled: true,
        config: { custom: "keep", binaryPath: resolve(root, "../die") },
      },
      other: { driver: "other", enabled: false, config: { token: "keep" } },
    },
  });
});

test("packaged bootstrap refuses malformed settings without launching T3", async () => {
  const root = await packagedBootstrap(
    `import { writeFile } from "node:fs/promises"; await writeFile(process.env.MARKER, "launched");\n`,
  );
  const marker = join(root, "entry-launched");
  const baseDir = join(root, "state");
  const settingsPath = join(baseDir, "userdata", "settings.json");
  await mkdir(join(baseDir, "userdata"), { recursive: true });
  await writeFile(settingsPath, "{not json");

  const result = await run([join(root, "t3"), "--base-dir", baseDir], {
    env: cleanEnv({ DIE_WEB_DIE_BINARY: "/fixture/die", MARKER: marker }),
  });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Refusing to replace unreadable T3 settings");
  expect(await readFile(settingsPath, "utf8")).toBe("{not json");
  expect(await Bun.file(marker).exists()).toBe(false);
});

test("packaged bootstrap refuses malformed provider instance settings", async () => {
  const root = await packagedBootstrap(
    `import { writeFile } from "node:fs/promises"; await writeFile(process.env.MARKER, "launched");\n`,
  );
  const marker = join(root, "entry-launched");
  const baseDir = join(root, "state");
  const settingsPath = join(baseDir, "userdata", "settings.json");
  await mkdir(join(baseDir, "userdata"), { recursive: true });
  const settings = { providerInstances: { pi: { driver: "pi", config: "not-an-object" } } };
  await writeFile(settingsPath, JSON.stringify(settings));

  const result = await run([join(root, "t3"), "--base-dir", baseDir], {
    env: cleanEnv({ DIE_WEB_DIE_BINARY: "/fixture/die", MARKER: marker }),
  });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Refusing to replace non-object T3 providerInstances.pi.config");
  expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual(settings);
  expect(await Bun.file(marker).exists()).toBe(false);
});
test("actual packaged bootstrap replaces itself and forwards normal T3 arguments", async () => {
  const root = await packagedBootstrap(
    `import { writeFile } from "node:fs/promises"; await writeFile(process.env.OUTPUT, JSON.stringify({ argv: process.argv, main: import.meta.main }));\n`,
  );
  const output = join(root, "args.json");
  const baseDir = join(root, "state");
  const result = await run([join(root, "t3"), "--host", "127.0.0.1", "--base-dir", baseDir, "--port", "4444"], {
    env: cleanEnv({ DIE_WEB_DIE_BINARY: "/fixture/die", OUTPUT: output }),
  });

  expect(result.code).toBe(0);
  const launched = JSON.parse(await readFile(output, "utf8"));
  expect(launched.argv.slice(1)).toEqual([
    join(root, "dist", "bin.mjs"),
    "--host",
    "127.0.0.1",
    "--base-dir",
    baseDir,
    "--port",
    "4444",
  ]);
  expect(launched.main).toBe(true);
});

test("T3CODE_HOME supplies state without changing forwarded arguments", async () => {
  const root = await packagedBootstrap(
    `import { writeFile } from "node:fs/promises"; await writeFile(process.env.OUTPUT, JSON.stringify(process.argv.slice(2)));\n`,
  );
  const output = join(root, "env-args.json");
  const baseDir = join(root, "env-state");
  const result = await run([join(root, "t3"), "--host", "localhost"], {
    env: cleanEnv({ DIE_WEB_DIE_BINARY: "/fixture/die", OUTPUT: output, T3CODE_HOME: baseDir }),
  });
  expect(result.code).toBe(0);
  expect(JSON.parse(await readFile(output, "utf8"))).toEqual(["--host", "localhost"]);
  expect(JSON.parse(await readFile(join(baseDir, "userdata", "settings.json"), "utf8"))).toEqual({
    providerInstances: {
      pi: { driver: "pi", enabled: true, config: { binaryPath: "/fixture/die" } },
    },
  });
});
