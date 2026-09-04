#!/usr/bin/env bun

import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import diePackage from "../package.json";
import assetImage from "../runtime-assets/assets/clankolas.png" with { type: "file" };
import metadata from "../runtime-assets/package.json" with { type: "file" };
import themeDark from "../runtime-assets/theme/dark.json" with { type: "file" };
import themeLight from "../runtime-assets/theme/light.json" with { type: "file" };
import themeSchema from "../runtime-assets/theme/theme-schema.json" with { type: "file" };
import exportTemplate from "../runtime-assets/export-html/template.html" with { type: "file" };
import highlight from "../runtime-assets/export-html/vendor/highlight.min.js" with { type: "file" };
import marked from "../runtime-assets/export-html/vendor/marked.min.js" with { type: "file" };
import asynchronousTasksExtension from "./tasks/extension";

const runtimeRoot = join(homedir(), ".die", "runtime", diePackage.version);
const embeddedAssets: Array<[string, string]> = [
  [metadata as unknown as string, "package.json"],
  [assetImage, "assets/clankolas.png"],
  [themeDark as unknown as string, "theme/dark.json"],
  [themeLight as unknown as string, "theme/light.json"],
  [themeSchema as unknown as string, "theme/theme-schema.json"],
  [exportTemplate as unknown as string, "export-html/template.html"],
  [highlight, "export-html/vendor/highlight.min.js"],
  [marked, "export-html/vendor/marked.min.js"],
];

// Bun stores embedded files under hashed names. Materialize the small set of
// assets Pi accesses by pathname so the executable remains a single artifact.
for (const [source, relativeTarget] of embeddedAssets) {
  const target = join(runtimeRoot, relativeTarget);
  try {
    await access(target);
    continue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(join(target, ".."), { recursive: true });
  try {
    // Runtime assets are immutable for a released version. Exclusive creation
    // means later launches perform no writes and concurrent launches do not
    // overwrite one another.
    await writeFile(target, await readFile(source), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

process.title = "die";
process.env.AI_AGENT = "die";
process.env.PI_CODING_AGENT = "true";
process.env.PI_PACKAGE_DIR = runtimeRoot;
// die has no self-update channel yet; suppress Pi's update lookup and banner.
process.env.PI_SKIP_VERSION_CHECK = "1";

if (process.argv[2] === "update") {
  console.error("die updates are disabled until an update channel is available.");
  process.exit(1);
}

// die owns the compiled entry point, including Pi's Bun-specific setup.
registerBunOAuthFlows();

// This must be dynamic: PI_PACKAGE_DIR has to be set before Pi initializes its
// product metadata and asset paths.
const { main } = await import("@earendil-works/pi-coding-agent");
await main(process.argv.slice(2), {
  extensionFactories: [{ name: "asynchronous-tasks", factory: asynchronousTasksExtension, hidden: true }],
});
