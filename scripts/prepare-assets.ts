import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const piRoot = join(root, "node_modules/@earendil-works/pi-coding-agent");
const photonRoot = join(root, "node_modules/@silvia-odwyer/photon-node");
const output = join(root, "runtime-assets");
const { version } = (await Bun.file(join(root, "package.json")).json()) as { version: string };

// The owned lazy-journal adapter relies on Pi's synchronous private seams.
// Refuse dependency drift at build/check time; upgrades need explicit review
// and parity tests, rather than silently falling back to full resident history.
const piPackage = JSON.parse(await readFile(join(piRoot, "package.json"), "utf8")) as { version: string };
const sessionManagerHash = createHash("sha256")
  .update(await readFile(join(piRoot, "dist/core/session-manager.js")))
  .digest("hex");
if (
  piPackage.version !== "0.87.0" ||
  sessionManagerHash !== "d365ffb5a189915c3af93953daf751bff45fe46222b05c426f8d8b845946bebf"
) {
  throw new Error("Unsupported Pi SessionManager: review the disk-backed history adapter before updating Pi");
}

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

await writeIfChanged(join(output, "photon_rs_bg.wasm"), await readFile(join(photonRoot, "photon_rs_bg.wasm")));

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
