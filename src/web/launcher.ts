import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, constants as osConstants } from "node:os";
import { dirname, join, resolve } from "node:path";

function expandHome(value: string): string {
  if (value === "~") return homedir();
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

function findBaseDir(args: string[], env: NodeJS.ProcessEnv): string {
  let value: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith("--base-dir=")) throw new Error("use --base-dir PATH (two arguments), not --base-dir=PATH");
    if (argument !== "--base-dir") continue;
    if (value !== undefined) throw new Error("--base-dir may only be specified once");
    value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--base-dir requires a path");
    index += 1;
  }
  value ??= env.T3CODE_HOME;
  if (!value) throw new Error("--base-dir PATH or T3CODE_HOME is required");
  return resolve(expandHome(value));
}

function objectSetting(value: unknown, label: string, settingsPath: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || Array.isArray(value) || typeof value !== "object")
    throw new Error(`Refusing to replace non-object T3 ${label} at ${settingsPath}`);
  return value as Record<string, unknown>;
}

export async function seedWebSettings(baseDir: string, dieBinary: string): Promise<void> {
  const settingsPath = join(baseDir, "userdata", "settings.json");
  let settings: unknown = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(`Refusing to replace unreadable T3 settings at ${settingsPath}: ${(error as Error).message}`);
  }
  const root = objectSetting(settings, "settings", settingsPath);
  objectSetting(root.providers, "providers", settingsPath);
  const providerInstances = objectSetting(root.providerInstances, "providerInstances", settingsPath);
  const pi = objectSetting(providerInstances.pi, "providerInstances.pi", settingsPath);
  const config = objectSetting(pi.config, "providerInstances.pi.config", settingsPath);
  const next = {
    ...root,
    providerInstances: {
      ...providerInstances,
      pi: { ...pi, driver: "pi", enabled: true, config: { ...config, binaryPath: resolve(expandHome(dieBinary)) } },
    },
  };
  await mkdir(dirname(settingsPath), { recursive: true });
  const temporary = settingsPath + ".tmp-" + process.pid + "-" + crypto.randomUUID();
  await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, settingsPath);
}

export function webLaunch(args: string[], env: NodeJS.ProcessEnv = process.env, executable = process.execPath) {
  const server = env.DIE_WEB_SERVER;
  const hasOption = (name: string) => args.some((arg) => arg === name || arg.startsWith(name + "="));
  return {
    server,
    args: [
      ...(hasOption("--host") ? [] : ["--host", "127.0.0.1"]),
      ...(hasOption("--base-dir") ? [] : ["--base-dir", join(env.HOME ?? homedir(), ".die", "web")]),
      ...args,
    ],
    env: {
      ...env,
      DIE_WEB_DIE_BINARY: env.DIE_WEB_DIE_BINARY ?? executable,
      DIE_WEB_TASK_EVENTS: "1",
    } as NodeJS.ProcessEnv,
  };
}

const WEB_TERMINATION_GRACE_MS = 5_000;

function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + (osConstants.signals[signal] ?? 0);
}

async function runExternal(server: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  try {
    accessSync(server, constants.X_OK);
  } catch {
    console.error("die web backend is not built. Remove DIE_WEB_SERVER to use the embedded backend.");
    return 1;
  }
  return new Promise<number>((done) => {
    const ownsProcessGroup = process.platform !== "win32";
    const child = spawn(server, args, { env, stdio: "inherit", detached: ownsProcessGroup });
    // detached makes the POSIX child the leader of a new process group. Capture
    // that ID once: never infer or signal the launcher's (possibly live die
    // session) process group.
    const ownedGroup = ownsProcessGroup && child.pid && child.pid !== process.pid ? child.pid : undefined;
    let requestedSignal: "SIGINT" | "SIGTERM" | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const signalOwnedBackend = (signal: NodeJS.Signals) => {
      try {
        if (ownedGroup !== undefined) process.kill(-ownedGroup, signal);
        else if (!ownsProcessGroup) child.kill(signal);
      } catch {
        // The owned process or group may already have exited.
      }
    };
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      if (killTimer) clearTimeout(killTimer);
      done(code);
    };
    const forward = (signal: "SIGINT" | "SIGTERM") => {
      requestedSignal ??= signal;
      signalOwnedBackend(signal);
      if (ownsProcessGroup && !killTimer) {
        killTimer = setTimeout(() => signalOwnedBackend("SIGKILL"), WEB_TERMINATION_GRACE_MS);
        killTimer.unref?.();
      }
    };
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");

    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.once("error", (error) => {
      console.error("Cannot start die web: " + error.message);
      finish(1);
    });
    child.once("exit", (code, signal) => {
      // A backend leader can exit while descendants continue. Since this is our
      // dedicated POSIX group, synchronously terminate those remaining members
      // before allowing the launcher to complete.
      if (ownsProcessGroup) signalOwnedBackend("SIGKILL");
      finish(requestedSignal ? signalExitCode(requestedSignal) : (code ?? (signal ? signalExitCode(signal) : 1)));
    });
  });
}

/** Launch the embedded Bun backend, or an explicit development override. */
export async function runWeb(args: string[]): Promise<number> {
  const launch = webLaunch(args);
  if (launch.server) return runExternal(launch.server, launch.args, launch.env);
  try {
    const baseDir = findBaseDir(launch.args, launch.env);
    const dieBinary = launch.env.DIE_WEB_DIE_BINARY;
    if (!dieBinary) throw new Error("DIE_WEB_DIE_BINARY is required");
    await seedWebSettings(baseDir, dieBinary);
    const cache = launch.env.XDG_CACHE_HOME
      ? join(launch.env.XDG_CACHE_HOME, "die")
      : join(launch.env.HOME ?? homedir(), ".cache", "die");
    const { embeddedWebRoot } = await import("./embedded");
    const root = await embeddedWebRoot(cache);
    // Compiled Bun's in-process createRequire resolution does not reliably resolve the
    // extracted native dependency graph. Self-exec as an interpreter; the bootstrap
    // immediately clears this flag before importing the backend or spawning children.
    return await runExternal(process.execPath, [join(root, "bootstrap.mjs"), ...launch.args], {
      ...launch.env,
      BUN_BE_BUN: "1",
    });
  } catch (error) {
    console.error("Cannot start die web: " + (error as Error).message);
    return 1;
  }
}
