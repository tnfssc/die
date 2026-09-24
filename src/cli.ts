#!/usr/bin/env bun

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import diePackage from "../package.json";
import assetImage from "../runtime-assets/assets/clankolas.png" with { type: "file" };
import exportTemplate from "../runtime-assets/export-html/template.html" with { type: "file" };
import highlight from "../runtime-assets/export-html/vendor/highlight.min.js" with { type: "file" };
import marked from "../runtime-assets/export-html/vendor/marked.min.js" with { type: "file" };
import metadata from "../runtime-assets/package.json" with { type: "file" };
import themeDark from "../runtime-assets/theme/dark.json" with { type: "file" };
import themeLight from "../runtime-assets/theme/light.json" with { type: "file" };
import themeSchema from "../runtime-assets/theme/theme-schema.json" with { type: "file" };
import { withDieSystemPrompt } from "./system-prompt";
import { formatThrownValue } from "./typescript/error-diagnostic";
import { INTERNAL_TYPESCRIPT_RUNNER_ARG, runTypeScriptFromStdin } from "./typescript/runner";
import { updateDie } from "./update";

const cliArgs = process.argv.slice(2);
// Hidden offline transport diagnostic. No normal CLI path reaches this branch.
if (cliArgs[0] === "--offline-openai-transport-probe") {
  if (cliArgs.length !== 1 || process.env.DIE_OFFLINE_OPENAI_TRANSPORT_PROBE !== "loopback-fake-key") {
    console.error("Offline OpenAI transport probe requires its explicit loopback test gate.");
    process.exit(1);
  }
  const { probeOpenAITransport } = await import("./live/offline-transport-probe");
  await probeOpenAITransport();
  process.exit(0);
}
if (cliArgs[0] === "--live-self-test") {
  if (cliArgs.length !== 1) throw new Error("Usage: die --live-self-test");
  const { testEmbeddedNativeHelper } = await import("./live/self-test");
  await testEmbeddedNativeHelper();
  process.exit(0);
}
if (cliArgs[0] === "update") {
  if (cliArgs.length === 2 && ["--help", "-h"].includes(cliArgs[1]!)) {
    console.log("Usage: die update\n\nInstall the latest stable release of this executable after SHA256 verification.");
    process.exit(0);
  }
  if (cliArgs.length !== 1) {
    console.error("Usage: die update");
    process.exit(1);
  }
  try {
    console.log("Checking for die updates...");
    const result = await updateDie({
      currentVersion: diePackage.version,
      onDownload: (version) => console.log("Downloading die " + version + "..."),
    });
    console.log(
      result.status === "updated"
        ? "Updated die to " + result.version + ". Restart running die sessions and web servers to fully use the update."
        : result.status === "current"
          ? "die is already current (" + result.version + ")"
          : "die is newer than the latest release (" + result.version + ")",
    );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
if (cliArgs[0] === "web") {
  const { runWeb } = await import("./web/launcher");
  process.exit(await runWeb(cliArgs.slice(1)));
}
if (cliArgs[0] === INTERNAL_TYPESCRIPT_RUNNER_ARG) {
  try {
    await runTypeScriptFromStdin();
    process.exit(0);
  } catch (error) {
    const diagnostic = formatThrownValue(error);
    console.error(diagnostic.replaceAll(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, "<execute-module>"));
    process.exit(1);
  }
}
const removedToolOptions = new Set([
  "--no-tools",
  "-nt",
  "--no-builtin-tools",
  "-nbt",
  "--tools",
  "-t",
  "--exclude-tools",
  "-xt",
]);
for (const argument of cliArgs) {
  if (argument === "--") break;
  const option = argument.split("=", 1)[0];
  if (removedToolOptions.has(option)) {
    console.error(`${option} is not supported by die; its core tool set is fixed by the current product phase.`);
    process.exit(1);
  }
}

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
// Die owns explicit self-updates; suppress Pi's separate update lookup and banner.
process.env.PI_SKIP_VERSION_CHECK = "1";

// die owns the compiled entry point, including Pi's Bun-specific setup.
registerBunOAuthFlows();

// This must be dynamic: PI_PACKAGE_DIR has to be set before Pi initializes its
// product metadata and asset paths.
const { main } = await import("@earendil-works/pi-coding-agent");
// Install the owned synchronous journal adapter before any SDK session is created.
const { installDiskBackedSessionManager } = await import("./history/session-manager");
installDiskBackedSessionManager();
// The UI extension imports Pi's CustomEditor, so it must also load only after
// die's runtime paths and product metadata are configured.
const [{ default: asynchronousTasksExtension }, { default: herdrAgentStateExtension }, { default: liveExtension }] =
  await Promise.all([import("./tasks/extension"), import("./herdr-agent-state"), import("./live/extension")]);
const [{ installQuietStartup }, { installConversationDensity }] = await Promise.all([
  import("./ui/startup"),
  import("./ui/conversation-density"),
]);
const restoreStartupSettings = installQuietStartup();
const restoreConversationDensity = installConversationDensity();

function filterHelp(text: string): string {
  if (!text.includes("Usage:") || !text.includes("Options:")) return text;
  const lines = text.split("\n");
  const filtered: string[] = [];
  let skipNextExample = false;
  for (const line of lines) {
    if (skipNextExample) {
      skipNextExample = false;
      continue;
    }
    if (line.includes(" update [source|self|pi]")) {
      filtered.push("  update                 Update die to the latest stable release");
      continue;
    }
    if (["--no-tools", "--no-builtin-tools", "--tools,", "--exclude-tools"].some((option) => line.includes(option)))
      continue;
    if (line.trim() === "Applies to built-in, extension, and custom tools") continue;
    if (
      line.trim() === "# Read-only mode (no file modifications possible)" ||
      line.trim() === "# Disable one tool while keeping the rest available"
    ) {
      skipNextExample = true;
      continue;
    }
    filtered.push(line.replace("AI coding assistant with read, bash, edit, write tools", "AI coding assistant"));
  }
  return filtered.join("\n");
}

const optionBoundary = cliArgs.indexOf("--");
const optionArgs = optionBoundary === -1 ? cliArgs : cliArgs.slice(0, optionBoundary);
const topLevelHelp = optionArgs.includes("--help") || optionArgs.includes("-h");
const originalLog = console.log;
if (topLevelHelp) {
  console.log = (...values: unknown[]) =>
    originalLog(...values.map((value) => (typeof value === "string" ? filterHelp(value) : value)));
}
try {
  await main(withDieSystemPrompt(cliArgs), {
    extensionFactories: [
      { name: "die-tools", factory: asynchronousTasksExtension, hidden: true },
      { name: "die-herdr-agent-state", factory: herdrAgentStateExtension, hidden: true },
      { name: "die-live", factory: liveExtension, hidden: true },
    ],
  });
} finally {
  restoreConversationDensity();
  restoreStartupSettings();
  console.log = originalLog;
}
