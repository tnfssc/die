import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function findBaseDir(args) {
  let value;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith("--base-dir=")) {
      throw new Error("use --base-dir PATH (two arguments), not --base-dir=PATH");
    }
    if (argument !== "--base-dir") continue;
    if (value !== undefined) throw new Error("--base-dir may only be specified once");
    value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--base-dir requires a path");
    index += 1;
  }

  value ??= process.env.T3CODE_HOME;
  if (!value) throw new Error("--base-dir PATH or T3CODE_HOME is required");
  return resolve(expandHome(value));
}

function objectSetting(value, label, settingsPath) {
  if (value === undefined) return {};
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Refusing to replace non-object T3 ${label} at ${settingsPath}`);
  }
  return value;
}

async function seedSettings(baseDir, dieBinary) {
  const settingsPath = join(baseDir, "userdata", "settings.json");
  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Refusing to replace unreadable T3 settings at ${settingsPath}: ${error.message}`);
    }
  }

  settings = objectSetting(settings, "settings", settingsPath);
  objectSetting(settings.providers, "providers", settingsPath);
  const providerInstances = objectSetting(settings.providerInstances, "providerInstances", settingsPath);
  const pi = objectSetting(providerInstances.pi, "providerInstances.pi", settingsPath);
  const config = objectSetting(pi.config, "providerInstances.pi.config", settingsPath);
  const next = {
    ...settings,
    providerInstances: {
      ...providerInstances,
      pi: {
        ...pi,
        driver: "pi",
        enabled: true,
        config: { ...config, binaryPath: dieBinary },
      },
    },
  };

  await mkdir(dirname(settingsPath), { recursive: true });
  const temporaryPath = `${settingsPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, settingsPath);
}

async function main() {
  const dieBinary = process.env.DIE_WEB_DIE_BINARY;
  if (!dieBinary) throw new Error("DIE_WEB_DIE_BINARY must point to the actual die executable");

  const args = process.argv.slice(2);
  const baseDir = findBaseDir(args);
  await seedSettings(baseDir, resolve(expandHome(dieBinary)));

  // Importing dist/bin.mjs cannot start T3: its import.meta.main guard is false when
  // imported. Replace this bootstrap process so T3 remains the signal-owning child.
  const root = dirname(fileURLToPath(import.meta.url));
  const serverEntry = join(root, "dist", "bin.mjs");
  if (typeof process.execve !== "function") {
    throw new Error("the packaged T3 server requires a Node.js version with process.execve");
  }
  process.execve(process.execPath, [process.execPath, serverEntry, ...args], process.env);
}

main().catch((error) => {
  console.error(`die-web: ${error.message}`);
  process.exitCode = 1;
});
