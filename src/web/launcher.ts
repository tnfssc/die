import { accessSync, constants } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function webLaunch(args: string[], env: NodeJS.ProcessEnv = process.env, executable = process.execPath) {
  const server = env.DIE_WEB_SERVER ?? join(dirname(executable), "die-web", "t3");
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

/** T3 owns browser startup and its server lifecycle; die only launches it. */
export async function runWeb(args: string[]): Promise<number> {
  const launch = webLaunch(args);
  try {
    accessSync(launch.server, constants.X_OK);
  } catch {
    console.error("die web backend is not built. Set DIE_WEB_SERVER to the T3 backend executable.");
    return 1;
  }
  return await new Promise<number>((resolve) => {
    const child = spawn(launch.server, launch.args, { env: launch.env, stdio: "inherit" });
    const interrupt = () => {
      child.kill("SIGINT");
    };
    const terminate = () => {
      child.kill("SIGTERM");
    };
    const finish = (code: number) => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      resolve(code);
    };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.once("error", (error) => {
      console.error("Cannot start die web: " + error.message);
      finish(1);
    });
    child.once("exit", (code, signal) => finish(code ?? (signal === "SIGINT" ? 130 : 143)));
  });
}
