import { describe, expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { run } from "./helpers";

const root = resolve(import.meta.dir, "..");
const assets = resolve(root, "runtime-assets");

async function filesWithMtimes(): Promise<Array<[string, number]>> {
  const entries = await readdir(assets, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = resolve(entry.parentPath, entry.name);
        return [path.slice(assets.length + 1), (await stat(path)).mtimeMs] as [string, number];
      }),
  ).then((files) => files.sort(([a], [b]) => a.localeCompare(b)));
}

describe("build asset preparation", () => {
  test("keeps only required assets and does not rewrite unchanged files", async () => {
    const before = await filesWithMtimes();
    expect(before.map(([path]) => path)).toEqual([
      "assets/clankolas.png",
      "export-html/template.html",
      "export-html/vendor/highlight.min.js",
      "export-html/vendor/marked.min.js",
      "package.json",
      "theme/dark.json",
      "theme/light.json",
      "theme/theme-schema.json",
    ]);

    await Bun.sleep(20);
    const result = await run([process.execPath, resolve(root, "scripts/prepare-assets.ts")], { cwd: root });
    expect(result.code).toBe(0);
    expect(await filesWithMtimes()).toEqual(before);
  });
});
