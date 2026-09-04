import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const piRoot = join(root, "node_modules/@earendil-works/pi-coding-agent");
const output = join(root, "runtime-assets");
const { version } = (await Bun.file(join(root, "package.json")).json()) as { version: string };

await rm(output, { recursive: true, force: true });
await mkdir(join(output, "export-html"), { recursive: true });

await Promise.all([
  cp(join(piRoot, "dist/modes/interactive/theme"), join(output, "theme"), {
    recursive: true,
  }),
  cp(join(piRoot, "dist/modes/interactive/assets"), join(output, "assets"), {
    recursive: true,
  }),
  cp(join(piRoot, "dist/core/export-html/template.html"), join(output, "export-html/template.html"), {
    recursive: true,
  }),
  cp(join(piRoot, "dist/core/export-html/vendor"), join(output, "export-html/vendor"), {
    recursive: true,
  }),
]);

await writeFile(
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
