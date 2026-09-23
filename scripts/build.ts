import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { access, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { packWebArchive } from "../src/web/archive";
import { buildWeb } from "./build-web";

const root = resolve(import.meta.dir, "..");
let reuseWeb = false;
let output = "dist/die";
let target: string | undefined;
for (const argument of process.argv.slice(2)) {
  if (argument === "--") continue;
  if (argument === "--reuse-web") reuseWeb = true;
  else if (argument.startsWith("--outfile=")) output = argument.slice("--outfile=".length);
  else if (argument.startsWith("--target=")) target = argument.slice("--target=".length);
  else throw new Error("Unknown build option: " + argument);
}
if (!output) throw new Error("--outfile requires a path");
if (target === "") throw new Error("--target requires a value");
const helperSource = process.env.DIE_LIVE_LAB_HELPER;
if (helperSource && target !== "bun-darwin-arm64") throw new Error("DIE_LIVE_LAB_HELPER requires --target=bun-darwin-arm64");
const outfile = resolve(root, output);
const webDirectory = resolve(root, "dist/die-web");
const archive = resolve(root, "dist/die-web.archive.gz");

if (reuseWeb) {
  await access(webDirectory);
  await cp(resolve(root, "support/die-web-bootstrap.mjs"), resolve(webDirectory, "bootstrap.mjs"));
  const hash = await packWebArchive(webDirectory, archive, { exclude: ["launcher.mjs", "t3"] });
  console.log("Packed existing web runtime (sha256 " + hash + ")");
} else await buildWeb();

// This file is not executed or probed for permissions during the build.
const helperFile = helperSource ? resolve(helperSource) : undefined;
if (helperFile && !(await lstat(helperFile)).isFile()) throw new Error("DIE_LIVE_LAB_HELPER must be a regular file, not a symlink");
const helperHash = helperFile ? createHash("sha256").update(await readFile(helperFile)).digest("hex") : undefined;
const compile = { outfile, ...(target ? { target } : {}) };
const result = await Bun.build({
  entrypoints: [resolve(root, "src/cli.ts")],
  compile: compile as Exclude<Parameters<typeof Bun.build>[0]["compile"], boolean | string | undefined>,
  minify: true,
  plugins: helperFile && helperHash ? [{ name: "live-lab-helper", setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]live-lab[\\/]embedded\.ts$/ }, () => ({
      contents: `import path from ${JSON.stringify(helperFile)} with { type: "file" };\nexport const embeddedHelper = { path, sha256: ${JSON.stringify(helperHash)} };`,
      loader: "ts",
    }));
  } }] : [],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("Built " + outfile);
