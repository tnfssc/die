import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INTERNAL_TYPESCRIPT_RUNNER_ARG } from "../src/typescript/runner";

const binary = resolve(import.meta.dir, "../dist/die");
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "die-typescript-test-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function runTypeScript(source: string, cwd = directory) {
  const child = Bun.spawn([binary, INTERNAL_TYPESCRIPT_RUNNER_ARG], {
    cwd,
    env: { HOME: join(directory, "home"), PATH: process.env.PATH ?? "" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(source);
  child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

describe("isolated TypeScript runner", () => {
  test("transpiles TypeScript in memory and supports files and commands", async () => {
    const result = await runTypeScript(`
      import { writeFile } from "node:fs/promises";
      const message: string = "typescript-runner-ok";
      await writeFile("result.txt", message);
      const command = Bun.spawnSync(["printf", "command-ok"], { stdout: "pipe" });
      console.log(message, command.stdout.toString());
    `);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("typescript-runner-ok command-ok");
    expect(result.stderr).toBe("");
    expect(await readFile(join(directory, "result.txt"), "utf8")).toBe("typescript-runner-ok");
    expect(await readdir(directory)).toEqual(["result.txt"]);
  });

  test("supports top-level modules, lazy imports, and require", async () => {
    await Bun.write(join(directory, "static.ts"), "export const staticValue: number = 20;");
    await Bun.write(join(directory, "lazy.ts"), "export const lazyValue: number = 21;");
    await Bun.write(join(directory, "common.cjs"), "module.exports = { commonValue: 1 };");

    const result = await runTypeScript(`
      import { staticValue } from "./static.ts";
      const { lazyValue } = await import("./lazy.ts");
      const { commonValue } = require("./common.cjs");
      export const total: number = staticValue + lazyValue + commonValue;
      const importLikeText = \`from "./static.ts"\`;
      // from "./static.ts" must remain a comment, not become a file URL.
      await Promise.resolve();
      console.log(total, importLikeText);
    `);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(`42 from "./static.ts"`);
    expect(result.stderr).toBe("");
  });

  test("provides filesystem-style module globals in paths containing spaces", async () => {
    const spaced = join(directory, "space dir");
    await mkdir(spaced);
    const result = await runTypeScript("console.log(__dirname, __filename)", spaced);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(`${spaced} ${join(spaced, "__die_execute__.ts")}`);
    expect(result.stdout).not.toContain("%20");
  });

  test("resolves installed packages for static and lazy imports", async () => {
    const projectRoot = resolve(import.meta.dir, "..");
    const result = await runTypeScript(`
      import { Type } from "typebox";
      const lazy = await import("typebox");
      const required = require("typebox");
      console.log(typeof Type.Object, typeof lazy.Type.String, typeof required.Type.Number);
    `, projectRoot);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("function function function");
    expect(result.stderr).toBe("");
  });

  test("sanitizes in-memory module URLs in failures", async () => {
    const result = await runTypeScript("throw new Error('runner-failed')");

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("runner-failed");
    expect(result.stderr).toContain("<execute-module>");
    expect(result.stderr).not.toContain("data:text/javascript;base64");
  });

  test("reports transpilation or execution failures", async () => {
    const result = await runTypeScript("throw new Error('runner-failed')");

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("runner-failed");
  });
});
