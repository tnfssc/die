import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const INTERNAL_TYPESCRIPT_RUNNER_ARG = "--die-internal-execute";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteLocalImports(javascript: string, transpiler: Bun.Transpiler, entryUrl: URL): string {
  const localSpecifiers = new Set(
    transpiler
      .scanImports(javascript)
      .map(({ path }) => path)
      .filter((path) => path.startsWith("./") || path.startsWith("../") || path.startsWith("/")),
  );

  let rewritten = javascript;
  for (const specifier of localSpecifiers) {
    const resolved = specifier.startsWith("/") ? pathToFileURL(specifier).href : new URL(specifier, entryUrl).href;
    const quoted = `(["'])${escapeRegExp(specifier)}\\2`;
    const patterns = [
      new RegExp(`(\\bfrom\\s*)${quoted}`, "g"),
      new RegExp(`(\\bimport\\s*)${quoted}`, "g"),
      new RegExp(`(\\bimport\\s*\\(\\s*)${quoted}`, "g"),
    ];
    for (const pattern of patterns) rewritten = rewritten.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(resolved)}`);
  }
  return rewritten;
}

export async function runTypeScriptFromStdin(): Promise<void> {
  const source = await Bun.stdin.text();
  if (!source.trim()) throw new Error("No TypeScript source was provided");

  const cwd = process.cwd();
  const entryUrl = pathToFileURL(join(cwd, "__die_execute__.ts"));
  Object.assign(globalThis, {
    require: createRequire(entryUrl),
    __dieExecuteDirname: cwd,
    __dieExecuteFilename: entryUrl.pathname,
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
  const javascript = rewriteLocalImports(transpiler.transformSync(source), transpiler, entryUrl);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  await import(moduleUrl);
}
