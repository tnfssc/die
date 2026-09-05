import { existsSync, readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { exports as resolveExports } from "resolve.exports";
import { init, parse as parseModules } from "es-module-lexer";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const INTERNAL_TYPESCRIPT_RUNNER_ARG = "--die-internal-execute";

// Compiled Bun executables cannot reliably resolve external bare packages.
// Locate their manifests on disk, but delegate export-map semantics (including
// condition order, wildcards, and private paths) to resolve.exports.
function resolveInstalledPackage(specifier: string, cwd: string, requireMode = false): string {
  const parts = specifier.split("/");
  const packageName = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const subpath = parts.slice(specifier.startsWith("@") ? 2 : 1).join("/");
  let directory = resolve(cwd);
  for (;;) {
    const packageDirectory = join(directory, "node_modules", packageName);
    const manifestPath = join(packageDirectory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const exportKey = subpath ? `./${subpath}` : ".";
      const hasExports = Object.hasOwn(manifest, "exports");
      const exported = hasExports
        ? resolveExports(manifest, exportKey, { require: requireMode, conditions: ["bun"] })?.[0]
        : undefined;
      if (hasExports && !exported) throw new Error(`Package path ${specifier} is not exported`);
      const target = exported
        ?? (subpath || (requireMode ? manifest.main : manifest.module ?? manifest.main))
        ?? "index.js";
      const resolved = resolve(packageDirectory, target);
      if (existsSync(resolved)) return resolved;
      for (const suffix of hasExports ? [] : [".ts", ".tsx", ".mjs", ".js", ".cjs", "/index.js"]) {
        if (existsSync(`${resolved}${suffix}`)) return `${resolved}${suffix}`;
      }
      throw new Error(`Cannot resolve package export ${specifier}`);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Cannot find installed package ${specifier} from ${cwd}`);
}

async function rewriteModuleImports(javascript: string, entryUrl: URL, cwd: string): Promise<string> {
  await init;
  const [imports] = parseModules(javascript);
  const replacements: Array<{ start: number; end: number; value: string }> = [];

  for (const imported of imports) {
    // Replace only the import keyword, not its arguments. This handles nested
    // and computed imports, preserves import options, and resolves lazily so
    // missing modules can be caught by submitted code.
    if (imported.d >= 0) {
      replacements.push({ start: imported.ss, end: imported.ss + 6, value: "globalThis.__dieExecuteImport" });
      continue;
    }
    const specifier = imported.n;
    if (!specifier || imported.d === -2) continue;
    let resolved: string;
    if (specifier.startsWith("./") || specifier.startsWith("../")) resolved = new URL(specifier, entryUrl).href;
    else if (specifier.startsWith("/")) resolved = pathToFileURL(specifier).href;
    else if (isBuiltin(specifier) || specifier === "bun" || specifier.includes(":")) continue;
    else resolved = pathToFileURL(resolveInstalledPackage(specifier, cwd)).href;
    replacements.push({
      start: imported.s,
      end: imported.e,
      value: imported.d === -1 ? resolved : JSON.stringify(resolved),
    });
  }

  let rewritten = javascript;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`;
  }
  return rewritten;
}

export async function runTypeScriptFromStdin(): Promise<void> {
  const source = await Bun.stdin.text();
  if (!source.trim()) throw new Error("No TypeScript source was provided");

  const cwd = process.cwd();
  const entryFilename = join(cwd, "__die_execute__.ts");
  const entryUrl = pathToFileURL(entryFilename);
  const nativeRequire = createRequire(entryUrl);
  const resolveRequire = (specifier: string, options?: { paths?: string[] }) => {
    if (isBuiltin(specifier) || specifier === "bun" || specifier.startsWith(".") || specifier.startsWith("/") || specifier.includes(":")) {
      return nativeRequire.resolve(specifier, options);
    }
    return resolveInstalledPackage(specifier, options?.paths?.[0] ?? cwd, true);
  };
  // Resolve before evaluating: never retry an evaluation error using an ESM
  // fallback, which could swallow the original exception or run code twice.
  const executeRequire = ((specifier: string) => nativeRequire(resolveRequire(specifier))) as NodeJS.Require;
  executeRequire.resolve = resolveRequire as NodeJS.RequireResolve;
  executeRequire.cache = nativeRequire.cache;
  executeRequire.extensions = nativeRequire.extensions;
  executeRequire.main = nativeRequire.main;

  Object.assign(globalThis, {
    require: executeRequire,
    __dieExecuteDirname: cwd,
    __dieExecuteFilename: entryFilename,
    __dieExecuteImport: async (value: unknown, options?: ImportCallOptions) => {
      const specifier = String(value);
      if (specifier.startsWith("./") || specifier.startsWith("../")) return import(new URL(specifier, entryUrl).href, options);
      if (specifier.startsWith("/")) return import(pathToFileURL(specifier).href, options);
      if (isBuiltin(specifier) || specifier === "bun" || specifier.includes(":")) return import(specifier, options);
      return import(pathToFileURL(resolveInstalledPackage(specifier, cwd)).href, options);
    },
  });

  const transpiler = new Bun.Transpiler({
    loader: "ts",
    target: "bun",
    define: {
      require: "globalThis.require",
      __dirname: "globalThis.__dieExecuteDirname",
      __filename: "globalThis.__dieExecuteFilename",
    },
  });
  const javascript = await rewriteModuleImports(transpiler.transformSync(source), entryUrl, cwd);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  await import(moduleUrl);
}
