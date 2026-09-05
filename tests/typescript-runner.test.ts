import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
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
    const result = await runTypeScript(
      `
      import { object } from "zod/mini";
      const lazy = await import("zod/mini");
      const required = require("zod/mini");
      console.log(typeof object, typeof lazy.string, typeof required.number);
    `,
      projectRoot,
    );

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("function function function");
    expect(result.stderr).toBe("");
  });

  test("preserves identity across static, dynamic, and transitive imports", async () => {
    const modules = join(directory, "node_modules");
    await mkdir(join(modules, "parent", "lib"), { recursive: true });
    await mkdir(join(modules, "leaf"), { recursive: true });
    await Bun.write(
      join(modules, "leaf", "package.json"),
      JSON.stringify({ name: "leaf", type: "module", exports: "./index.js" }),
    );
    await Bun.write(
      join(modules, "leaf", "index.js"),
      `globalThis.__leafLoads = (globalThis.__leafLoads ?? 0) + 1; export const loads = globalThis.__leafLoads;`,
    );
    await Bun.write(
      join(modules, "parent", "package.json"),
      JSON.stringify({ name: "parent", type: "module", exports: "./index.js" }),
    );
    await Bun.write(join(modules, "parent", "lib", "local.js"), 'import { loads } from "leaf"; export { loads };');
    await Bun.write(
      join(modules, "parent", "index.js"),
      'export { loads } from "./lib/local.js"; export const lazyLoads = import("leaf").then((module) => module.loads);',
    );

    const result = await runTypeScript(`
      import { loads, lazyLoads } from "parent";
      const again = await import("parent");
      console.log(loads, await lazyLoads, again.loads, globalThis.__leafLoads);
    `);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("1 1 1 1");
    expect(result.stderr).toBe("");
  });

  test("loads a representative installed package with transitive dependencies", async () => {
    const projectRoot = resolve(import.meta.dir, "..");
    const result = await runTypeScript(
      `
      import { SessionManager } from "@earendil-works/pi-coding-agent";
      console.log(typeof SessionManager);
    `,
      projectRoot,
    );

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("function");
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
    await Bun.write(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "fixture",
        type: "module",
        exports: {
          ".": { import: "./esm.js", require: "./cjs.cjs" },
          "./priority": { default: "./esm.js", import: "./wrong.js" },
          "./features/*": "./features/*.js",
          "./private.js": null,
        },
      }),
    );
    await Bun.write(join(pkg, "esm.js"), 'export const value = "esm";');
    await Bun.write(join(pkg, "cjs.cjs"), 'module.exports = { value: "cjs" };');
    await Bun.write(join(pkg, "wrong.js"), 'export const value = "wrong";');
    await Bun.write(join(pkg, "features/a.js"), 'export { value } from "../esm.js";');
    await Bun.write(join(pkg, "private.js"), "export const secret = true;");
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

  test("preserves native CommonJS identity across transitive computed require, cycles, and module.require", async () => {
    const modules = join(directory, "node_modules");
    const parent = join(modules, "cjs-parent");
    const dependency = join(modules, "cjs-dependency");
    await mkdir(parent, { recursive: true });
    await mkdir(dependency, { recursive: true });
    await Bun.write(
      join(dependency, "package.json"),
      JSON.stringify({
        name: "cjs-dependency",
        exports: { import: "./wrong.js", require: "./index.cjs" },
      }),
    );
    await Bun.write(join(dependency, "index.cjs"), 'module.exports = { condition: "require" };');
    await Bun.write(join(dependency, "wrong.js"), 'export const condition = "import";');
    await Bun.write(join(parent, "package.json"), JSON.stringify({ name: "cjs-parent", main: "index.cjs" }));
    await Bun.write(
      join(parent, "shared.cjs"),
      "globalThis.__sharedLoads = (globalThis.__sharedLoads ?? 0) + 1; module.exports = { loads: globalThis.__sharedLoads };",
    );
    await Bun.write(join(parent, "a.cjs"), 'exports.name = "a"; exports.fromB = require("./b.cjs").sawA;');
    await Bun.write(join(parent, "b.cjs"), 'exports.sawA = require("./a.cjs").name;');
    await Bun.write(
      join(parent, "index.cjs"),
      `
      const dependencyName = "cjs-" + "dependency";
      const shared = require("./shared.cjs");
      const sharedAgain = require("./shared.cjs");
      const dependency = require(dependencyName);
      module.exports = {
        shared, same: shared === sharedAgain,
        cycle: require("./a.cjs").fromB,
        condition: dependency.condition,
        moduleRequire: module.require(dependencyName).condition,
        resolved: require.resolve(dependencyName),
        cached: require.cache[require.resolve("./shared.cjs")].exports === shared,
        builtin: typeof require("node:fs").readFile,
      };
    `,
    );

    const result = await runTypeScript(`
      const first = require("cjs-parent");
      const second = require("cjs-parent");
      console.log(first === second, first.same, first.cycle, first.condition, first.moduleRequire,
        first.cached, first.builtin, first.shared.loads, first.resolved.endsWith("cjs-dependency/index.cjs"));
    `);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("true true a require require true function 1 true");
    expect(result.stderr).toBe("");
  });

  test("preserves require evaluation errors without retrying another package entry", async () => {
    const pkg = join(directory, "node_modules", "broken");
    await mkdir(pkg, { recursive: true });
    await Bun.write(
      join(pkg, "package.json"),
      JSON.stringify({ name: "broken", exports: { require: "./bad.cjs", import: "./good.js" } }),
    );
    await Bun.write(join(pkg, "bad.cjs"), 'throw new Error("original-failure");');
    await Bun.write(join(pkg, "good.js"), 'export const value = "incorrect-fallback";');
    const result = await runTypeScript('try { require("broken"); } catch (error) { console.log(error.message); }');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("original-failure");
  });

  test("loads local dependency graphs and built-ins through each import style", async () => {
    await Bun.write(
      join(directory, "node_modules/dependency/package.json"),
      JSON.stringify({ name: "dependency", main: "index.js", type: "module" }),
    );
    await Bun.write(join(directory, "node_modules/dependency/index.js"), "export const value = 42;");
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

  test("preserves dependency URLs, relative assets, runtime imports, and lazy failures", async () => {
    const pkg = join(directory, "node_modules/runtime-fixture");
    await mkdir(pkg, { recursive: true });
    await Bun.write(
      join(pkg, "package.json"),
      JSON.stringify({ name: "runtime-fixture", type: "module", exports: "./index.js" }),
    );
    await Bun.write(join(pkg, "asset.txt"), "asset-ok");
    await Bun.write(join(pkg, "child.js"), "export const value = 42;");
    await Bun.write(
      join(pkg, "index.js"),
      `
      import { readFile } from "node:fs/promises";
      export const url = import.meta.url;
      export const asset = await readFile(new URL("./asset.txt", import.meta.url), "utf8");
      export const load = (name) => import("./" + name + ".js");
      export const never = () => import("missing-dependency-from-fixture");
    `,
    );
    const result = await runTypeScript(`
      import * as fixture from "runtime-fixture";
      console.log(fixture.url, fixture.asset, (await fixture.load("child")).value);
      try { await fixture.never(); } catch { console.log("lazy-missing"); }
    `);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`file://${join(pkg, "index.js")} asset-ok 42`);
    expect(result.stdout.trim().endsWith("lazy-missing")).toBeTrue();
  });

  test("supports package imports and caches failed module evaluation", async () => {
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({
        type: "module",
        imports: { "#value": { bun: "./value.js", default: "./wrong.js" } },
      }),
    );
    await Bun.write(join(directory, "value.js"), 'export const value = "alias-ok";');
    await Bun.write(join(directory, "wrong.js"), 'export const value = "wrong";');
    await Bun.write(
      join(directory, "fails.js"),
      'globalThis.__failLoads = (globalThis.__failLoads ?? 0) + 1; throw new Error("boom");',
    );
    const result = await runTypeScript(`
      import { value } from "#value";
      for (let index = 0; index < 2; index++) try { await import("./fails.js"); } catch {}
      console.log(value, globalThis.__failLoads);
    `);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("alias-ok 1");
  });

  test("transpiles external TypeScript before lexing type-only imports", async () => {
    const pkg = join(directory, "node_modules/typed-fixture");
    await mkdir(pkg, { recursive: true });
    await Bun.write(
      join(pkg, "package.json"),
      JSON.stringify({ name: "typed-fixture", type: "module", exports: "./index.ts" }),
    );
    await Bun.write(join(pkg, "types.ts"), "export interface Present { value: number }");
    await Bun.write(join(pkg, "runtime.ts"), "export const runtime: number = 42;");
    await Bun.write(
      join(pkg, "index.ts"),
      'import type { Present } from "./types.ts"; import type { Gone } from "missing-type-package"; import { runtime } from "./runtime.ts"; const value: Present = { value: runtime }; export default value.value;',
    );
    const result = await runTypeScript('import value from "typed-fixture"; console.log(value);');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("42");
    expect(result.stderr).toBe("");
  });

  test("uses canonical onLoad paths for symlinked pnpm-style graphs", async () => {
    const store = join(directory, "node_modules/.pnpm");
    const parent = join(store, "parent@1/node_modules/parent");
    const leaf = join(store, "leaf@1/node_modules/leaf");
    await mkdir(parent, { recursive: true });
    await mkdir(leaf, { recursive: true });
    await Bun.write(
      join(parent, "package.json"),
      JSON.stringify({ name: "parent", type: "module", exports: "./index.js" }),
    );
    await Bun.write(join(parent, "index.js"), 'import { value } from "leaf"; export { value };');
    await Bun.write(
      join(leaf, "package.json"),
      JSON.stringify({ name: "leaf", type: "module", exports: "./index.js" }),
    );
    await Bun.write(join(leaf, "index.js"), 'export const value = "pnpm-ok";');
    await symlink(parent, join(directory, "node_modules/parent"), "dir");
    await symlink(leaf, join(store, "parent@1/node_modules/leaf"), "dir");
    const result = await runTypeScript('import { value } from "parent"; console.log(value);');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("pnpm-ok");
    expect(result.stderr).toBe("");
  });

  test("registers ESM graphs reached by native and root CommonJS require", async () => {
    const modules = join(directory, "node_modules");
    for (const name of ["cjs-requirer", "esm-target", "esm-root", "esm-leaf"])
      await mkdir(join(modules, name), { recursive: true });
    await Bun.write(
      join(modules, "esm-leaf/package.json"),
      JSON.stringify({ name: "esm-leaf", type: "module", exports: "./index.js" }),
    );
    await Bun.write(join(modules, "esm-leaf/index.js"), "export const value = 21;");
    for (const name of ["esm-target", "esm-root"]) {
      await Bun.write(
        join(modules, name, "package.json"),
        JSON.stringify({ name, type: "module", exports: "./index.js" }),
      );
      await Bun.write(
        join(modules, name, "index.js"),
        'import { value } from "esm-leaf"; export const answer = value * 2;',
      );
    }
    await Bun.write(
      join(modules, "cjs-requirer/package.json"),
      JSON.stringify({ name: "cjs-requirer", main: "./index.cjs" }),
    );
    await Bun.write(join(modules, "cjs-requirer/index.cjs"), 'module.exports = require("esm-target");');
    const result = await runTypeScript('console.log(require("cjs-requirer").answer, require("esm-root").answer);');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("42 42");
    expect(result.stderr).toBe("");
  });

  test("resolves computed dynamic imports from native CommonJS", async () => {
    const modules = join(directory, "node_modules");
    for (const name of ["cjs-dynamic", "dynamic-target", "dynamic-leaf"])
      await mkdir(join(modules, name), { recursive: true });
    await Bun.write(
      join(modules, "cjs-dynamic/package.json"),
      JSON.stringify({ name: "cjs-dynamic", main: "./index.cjs" }),
    );
    await Bun.write(join(modules, "cjs-dynamic/index.cjs"), "module.exports = (name) => import(name);");
    await Bun.write(
      join(modules, "dynamic-target/package.json"),
      JSON.stringify({ name: "dynamic-target", type: "module", exports: "./index.js" }),
    );
    await Bun.write(
      join(modules, "dynamic-target/index.js"),
      'import { value } from "dynamic-leaf"; export { value };',
    );
    await Bun.write(
      join(modules, "dynamic-leaf/package.json"),
      JSON.stringify({ name: "dynamic-leaf", type: "module", exports: "./index.js" }),
    );
    await Bun.write(join(modules, "dynamic-leaf/index.js"), 'export const value = "dynamic-ok";');
    const result = await runTypeScript(
      'const load = require("cjs-dynamic"); console.log((await load("dynamic-target")).value);',
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("dynamic-ok");
    expect(result.stderr).toBe("");
  });

  test("honors every require.resolve options.paths entry", async () => {
    const second = join(directory, "second");
    const pkg = join(second, "node_modules/path-target");
    await mkdir(pkg, { recursive: true });
    await Bun.write(join(pkg, "package.json"), JSON.stringify({ name: "path-target", main: "index.cjs" }));
    await Bun.write(join(pkg, "index.cjs"), "module.exports = true;");
    const result = await runTypeScript(
      'console.log(require.resolve("path-target", { paths: ["' +
        join(directory, "first") +
        '", "' +
        second +
        '"] }).endsWith("path-target/index.cjs"));',
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("true");
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
