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

  test("resolves computed and nested dynamic imports without eagerly loading missing modules", async () => {
    await Bun.write(join(directory, "local.ts"), 'export const value = 42; export const next = "./local.ts";');
    const result = await runTypeScript(`
      const name = "local";
      const module = await import(\`./\${name}.ts\`);
      console.log(module.value, (await import((await import("./local.ts")).next)).value);
      try { await import("./missing.ts"); } catch { console.log("caught"); }
      try { await import("missing-package"); } catch { console.log("caught-package"); }
      if (Date.now() < 0) await import("another-missing-package");
    `);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("42 42\ncaught\ncaught-package");
  });

  test("respects package export conditions, patterns, and private subpaths", async () => {
    const pkg = join(directory, "node_modules", "fixture");
    await mkdir(pkg, { recursive: true });
    await Bun.write(join(pkg, "package.json"), JSON.stringify({
      name: "fixture", type: "module",
      exports: {
        ".": { import: "./esm.js", require: "./cjs.cjs" },
        "./priority": { default: "./esm.js", import: "./wrong.js" },
        "./features/*": "./features/*.js",
        "./private.js": null,
      },
    }));
    await Bun.write(join(pkg, "esm.js"), 'export const value = "esm";');
    await Bun.write(join(pkg, "cjs.cjs"), 'module.exports = { value: "cjs" };');
    await Bun.write(join(pkg, "wrong.js"), 'export const value = "wrong";');
    await Bun.write(join(pkg, "features/a.js"), 'export { value } from "../esm.js";');
    await Bun.write(join(pkg, "private.js"), 'export const secret = true;');
    const result = await runTypeScript(`
      import { value } from "fixture";
      import { value as priority } from "fixture/priority";
      import { value as feature } from "fixture/features/a";
      const name = "fixture";
      console.log(value, require(name).value, (await import(name)).value, priority, feature);
      for (const name of ["fixture/private.js", "fixture/wrong.js"]) {
        try { await import(name); console.log("LEAK"); } catch { console.log("blocked"); }
        try { require(name); console.log("LEAK"); } catch { console.log("blocked"); }
      }
    `);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("esm cjs esm esm esm\nblocked\nblocked\nblocked\nblocked");
  });

  test("preserves require evaluation errors without retrying another package entry", async () => {
    const pkg = join(directory, "node_modules", "broken");
    await mkdir(pkg, { recursive: true });
    await Bun.write(join(pkg, "package.json"), JSON.stringify({ name: "broken", exports: { require: "./bad.cjs", import: "./good.js" } }));
    await Bun.write(join(pkg, "bad.cjs"), 'throw new Error("original-failure");');
    await Bun.write(join(pkg, "good.js"), 'export const value = "incorrect-fallback";');
    const result = await runTypeScript('try { require("broken"); } catch (error) { console.log(error.message); }');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("original-failure");
  });

  test("loads local dependency graphs and built-ins through each import style", async () => {
    await Bun.write(join(directory, "node_modules/dependency/package.json"), JSON.stringify({ name: "dependency", main: "index.js", type: "module" }));
    await Bun.write(join(directory, "node_modules/dependency/index.js"), 'export const value = 42;');
    await Bun.write(join(directory, "nested/entry.ts"), 'import { value } from "dependency"; export { value };');
    await Bun.write(join(directory, "data.json"), '{"ok":true}');
    const result = await runTypeScript(`
      import { value } from "./nested/entry.ts";
      import { basename } from "path";
      const builtin = "fs";
      const file = "./data.json";
      console.log(value, basename("/a/b"), typeof (await import(builtin)).readFile, typeof require(builtin).readFile);
      console.log((await import(file, { with: { type: "json" } })).default.ok);
    `);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("42 b function function\ntrue");
  });

  test("reports syntax errors and explicit early exits", async () => {
    expect((await runTypeScript("const = ;")).code).toBe(1);
    expect((await runTypeScript("process.exit(7)")).code).toBe(7);
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
