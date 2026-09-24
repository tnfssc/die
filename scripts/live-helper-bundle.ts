import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BunPlugin } from "bun";

/** The old updater replaces one raw executable; compile the native payload inside it. */
export async function nativeHelperPlugin(input: string, target: string): Promise<BunPlugin> {
  if (target !== "bun-darwin-arm64") throw new Error("Native helper embedding requires bun-darwin-arm64");
  const path = resolve(input);
  if (!(await lstat(path)).isFile()) throw new Error("Native helper must be a regular file, not a symlink");
  const bytes = await readFile(path);
  if (
    bytes.length < 32 ||
    bytes.readUInt32LE(0) !== 0xfeedfacf ||
    bytes.readUInt32LE(4) !== 0x0100000c ||
    bytes.readUInt32LE(12) !== 2
  )
    throw new Error("Native helper must be a Mach-O arm64 executable");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    name: "live-helper",
    setup(build) {
      build.onLoad({ filter: /[\/]src[\/]live[\/]embedded\.ts$/ }, () => ({
        contents:
          "import path from " +
          JSON.stringify(path) +
          ' with { type: "file" };\nexport const embeddedHelper = { path, sha256: ' +
          JSON.stringify(sha256) +
          " };",
        loader: "ts",
      }));
    },
  };
}
