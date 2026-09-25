import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../helpers";
import { seedWebSettings, webLaunch } from "../../src/t3/web/launcher";

test("web configures the embedded backend on loopback with separate T3 state", () => {
  const launch = webLaunch([], { HOME: "/fixture", PATH: "/bin" }, "/tools/die");
  expect(launch.server).toBeUndefined();
  expect(launch.args).toEqual(["--host", "127.0.0.1", "--base-dir", "/fixture/.die/web"]);
  expect(launch.env.DIE_WEB_DIE_BINARY).toBe("/tools/die");
  expect(launch.env.PATH).toBe("/bin");
});

test("web forwards T3 options and explicit development executable overrides", () => {
  const env = { HOME: "/fixture", DIE_WEB_SERVER: "/build/t3", DIE_WEB_DIE_BINARY: "/build/die" };
  const launch = webLaunch(["--port", "4444", "--no-browser"], env, "/tools/die");
  expect(launch.server).toBe("/build/t3");
  expect(launch.args.slice(-3)).toEqual(["--port", "4444", "--no-browser"]);
  expect(launch.env.DIE_WEB_DIE_BINARY).toBe("/build/die");
  expect(env).toEqual({ HOME: "/fixture", DIE_WEB_SERVER: "/build/t3", DIE_WEB_DIE_BINARY: "/build/die" });
});

test("compiled die web dispatches directly to the backend and preserves its exit status", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-web-launch-"));
  try {
    const server = join(home, "backend");
    await writeFile(
      server,
      "#!/usr/bin/env node\nconsole.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),binary:process.env.DIE_WEB_DIE_BINARY})); process.exit(7);\n",
    );
    await chmod(server, 0o755);
    const binary = resolve(process.env.DIE_WEB_BINARY ?? resolve(import.meta.dir, "../../dist/die"));
    const result = await run([binary, "web", "--no-browser"], {
      cwd: home,
      env: { HOME: home, PATH: process.env.PATH, DIE_WEB_SERVER: server },
    });
    expect(result.code).toBe(7);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      args: ["--host", "127.0.0.1", "--base-dir", join(home, ".die", "web"), "--no-browser"],
      cwd: home,
      binary,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("compiled die web reports a missing backend without entering the agent", async () => {
  const result = await run([resolve(process.env.DIE_WEB_BINARY ?? resolve(import.meta.dir, "../../dist/die")), "web"], {
    env: { PATH: process.env.PATH, DIE_WEB_SERVER: "/nonexistent/die-web-fixture" },
  });
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("die web backend is not built");
});

test.each([
  { args: ["--base-dir", "/custom"], expected: ["--host", "127.0.0.1", "--base-dir", "/custom"] },
  { args: ["--base-dir=/custom"], expected: ["--host", "127.0.0.1", "--base-dir=/custom"] },
  { args: ["--host=127.0.0.2"], expected: ["--base-dir", "/fixture/.die/web", "--host=127.0.0.2"] },
])("web respects explicit defaults: $args", ({ args, expected }) => {
  expect(webLaunch([...args], { HOME: "/fixture" }, "/tools/die").args).toEqual([...expected]);
});

test("embedded web settings enable only Die on first run", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-web-settings-first-run-"));
  try {
    const settings = join(home, "userdata", "settings.json");
    await seedWebSettings(home, "/fixture/die");
    expect(JSON.parse(await Bun.file(settings).text())).toEqual({
      providers: {
        codex: { enabled: false },
        claudeAgent: { enabled: false },
        cursor: { enabled: false },
        grok: { enabled: false },
        pi: { enabled: true },
        opencode: { enabled: false },
        antigravity: { enabled: false },
      },
      providerInstances: {
        codex: { driver: "codex", enabled: false },
        claudeAgent: { driver: "claudeAgent", enabled: false },
        cursor: { driver: "cursor", enabled: false },
        grok: { driver: "grok", enabled: false },
        pi: { driver: "pi", enabled: true, config: { binaryPath: "/fixture/die" } },
        opencode: { driver: "opencode", enabled: false },
        antigravity: { driver: "antigravity", enabled: false },
      },
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("embedded web settings preserve unrelated configuration", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-web-settings-"));
  try {
    const settings = join(home, "userdata", "settings.json");
    await Bun.write(
      settings,
      JSON.stringify({
        theme: "dark",
        providers: { codex: { enabled: true }, claudeAgent: { enabled: true } },
        providerInstances: {
          pi: { config: { custom: true } },
          codex: { driver: "codex", enabled: true },
          other: { enabled: true },
        },
      }),
    );
    await seedWebSettings(home, "/fixture/die");
    expect(JSON.parse(await Bun.file(settings).text())).toEqual({
      theme: "dark",
      providers: { codex: { enabled: true }, claudeAgent: { enabled: true } },
      providerInstances: {
        pi: { driver: "pi", enabled: true, config: { custom: true, binaryPath: "/fixture/die" } },
        codex: { driver: "codex", enabled: true },
        other: { enabled: true },
      },
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("embedded web settings refuse malformed existing files", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-web-settings-bad-"));
  try {
    const settings = join(home, "userdata", "settings.json");
    await Bun.write(settings, "{bad");
    await expect(seedWebSettings(home, "/fixture/die")).rejects.toThrow("Refusing to replace unreadable T3 settings");
    expect(await Bun.file(settings).text()).toBe("{bad");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test.each([null, [], { providers: [] }, { providerInstances: { pi: { config: "bad" } } }].map((value) => ({ value })))(
  "embedded web settings refuse malformed structures: %j",
  async ({ value }) => {
    const home = await mkdtemp(join(tmpdir(), "die-web-settings-shape-"));
    try {
      const settings = join(home, "userdata", "settings.json");
      const original = JSON.stringify(value);
      await Bun.write(settings, original);
      await expect(seedWebSettings(home, "/fixture/die")).rejects.toThrow("Refusing to replace non-object T3");
      expect(await Bun.file(settings).text()).toBe(original);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
