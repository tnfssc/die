import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { init, parse as parseModules } from "es-module-lexer";
import { dirname, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const INTERNAL_TYPESCRIPT_RUNNER_ARG = "--die-internal-execute";

function packageTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(packageTarget).find(Boolean);
  if (!value || typeof value !== "object") return undefined;
  const conditions = value as Record<string, unknown>;
  for (const condition of ["import", "bun", "node", "default"]) {
    const target = packageTarget(conditions[condition]);
    if (target) return target;
  }
  return undefined;
}

function resolveInstalledPackage(specifier: string, cwd: string): string {
  const parts = specifier.split("/");
  const packageName = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const subpath = parts.slice(specifier.startsWith("@") ? 2 : 1).join("/");
  let directory = resolve(cwd);
  for (;;) {
    const packageDirectory = join(directory, "node_modules", packageName);
    const manifestPath = join(packageDirectory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        exports?: unknown;
        module?: string;
        main?: string;
      };
      const exportKey = subpath ? `./${subpath}` : ".";
      const exportsMap = manifest.exports && typeof manifest.exports === "object"
        ? manifest.exports as Record<string, unknown>
        : undefined;
      const exportsValue = exportsMap
        ? exportsMap[exportKey] ?? (!subpath && !Object.keys(exportsMap).some((key) => key.startsWith(".")) ? exportsMap : undefined)
        : !subpath ? manifest.exports : undefined;
      const target = packageTarget(exportsValue)
        ?? (subpath ? subpath : manifest.module ?? manifest.main)
        ?? "index.js";
      const resolved = resolve(packageDirectory, target);
      if (existsSync(resolved)) return resolved;
      for (const suffix of [".ts", ".tsx", ".mjs", ".js", ".cjs", "/index.js"]) {
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
    const specifier = imported.n;
    if (!specifier || imported.d === -2) continue;
    let resolved: string;
    if (specifier.startsWith("./") || specifier.startsWith("../")) resolved = new URL(specifier, entryUrl).href;
    else if (specifier.startsWith("/")) resolved = pathToFileURL(specifier).href;
    else if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier.includes(":")) continue;
    else {
      try {
        resolved = pathToFileURL(Bun.resolveSync(specifier, cwd)).href;
      } catch {
        resolved = pathToFileURL(resolveInstalledPackage(specifier, cwd)).href;
      }
    }
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
  const executeRequire = ((specifier: string) => {
    try {
      return nativeRequire(specifier);
    } catch (error) {
      if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.includes(":")) throw error;
      return nativeRequire(resolveInstalledPackage(specifier, cwd));
    }
  }) as NodeJS.Require;
  executeRequire.resolve = ((specifier: string) => {
    try {
      return nativeRequire.resolve(specifier);
    } catch {
      return resolveInstalledPackage(specifier, cwd);
    }
  }) as NodeJS.RequireResolve;
  executeRequire.cache = nativeRequire.cache;
  executeRequire.extensions = nativeRequire.extensions;
  executeRequire.main = nativeRequire.main;

  Object.assign(globalThis, {
    require: executeRequire,
    __dieExecuteDirname: cwd,
    __dieExecuteFilename: entryFilename,
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
