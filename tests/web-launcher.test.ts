import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";
import { webLaunch } from "../src/web/launcher";

test("web launches the adjacent backend on loopback with separate T3 state", () => {
  const launch = webLaunch([], { HOME: "/fixture", PATH: "/bin" }, "/tools/die");
  expect(launch.server).toBe("/tools/die-web/t3");
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
    const binary = resolve(import.meta.dir, "../dist/die");
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
  const result = await run([resolve(import.meta.dir, "../dist/die"), "web"], {
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
