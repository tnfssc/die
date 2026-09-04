import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const piRoot = join(root, "node_modules/@earendil-works/pi-coding-agent");
const output = join(root, "runtime-assets");
const { version } = (await Bun.file(join(root, "package.json")).json()) as { version: string };

const assets: Array<[string, string]> = [
  ["dist/modes/interactive/theme/dark.json", "theme/dark.json"],
  ["dist/modes/interactive/theme/light.json", "theme/light.json"],
  ["dist/modes/interactive/theme/theme-schema.json", "theme/theme-schema.json"],
  ["dist/modes/interactive/assets/clankolas.png", "assets/clankolas.png"],
  ["dist/core/export-html/template.html", "export-html/template.html"],
  ["dist/core/export-html/vendor/highlight.min.js", "export-html/vendor/highlight.min.js"],
  ["dist/core/export-html/vendor/marked.min.js", "export-html/vendor/marked.min.js"],
];

async function writeIfChanged(target: string, content: Uint8Array | string): Promise<void> {
  const next = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
  try {
    const current = await readFile(target);
    if (current.equals(next)) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, next);
}

await Promise.all(
  assets.map(async ([source, target]) => {
    await writeIfChanged(join(output, target), await readFile(join(piRoot, source)));
  }),
);

await writeIfChanged(
  join(output, "package.json"),
  `${JSON.stringify(
    {
      name: "die",
      version,
      description: "A coding agent built on Pi",
      piConfig: { name: "die", configDir: ".die" },
    },
    null,
    2,
  )}\n`,
);
