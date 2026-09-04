import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { BoundedOutputBuffer } from "../tasks/output-buffer";
import { INTERNAL_TYPESCRIPT_RUNNER_ARG } from "./runner";

const MAX_STREAM_BYTES = 1_000_000;

const ExecuteParameters = Type.Object({
  code: Type.String({ description: "TypeScript source to transpile and execute" }),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0.1, description: "Optional execution timeout" })),
});

interface ExecutionResult {
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  stdoutLost: boolean;
  stderrLost: boolean;
  timedOut: boolean;
}

function signalProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The isolated child may already have exited.
    }
  }
}

async function executeIsolated(code: string, cwd: string, signal: AbortSignal | undefined, timeoutMs?: number): Promise<ExecutionResult> {
  const child = spawn(process.execPath, [INTERNAL_TYPESCRIPT_RUNNER_ARG], {
    cwd,
    env: process.env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = new BoundedOutputBuffer(MAX_STREAM_BYTES);
  const stderr = new BoundedOutputBuffer(MAX_STREAM_BYTES);
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const terminate = (fromTimeout = false) => {
    if (fromTimeout) timedOut = true;
    signalProcessGroup(child, "SIGTERM");
    killTimer ??= setTimeout(() => signalProcessGroup(child, "SIGKILL"), 5_000);
    killTimer.unref?.();
  };
  const onAbort = () => terminate();
  if (signal?.aborted) terminate();
  else signal?.addEventListener("abort", onAbort, { once: true });
  if (timeoutMs) {
    timeout = setTimeout(() => terminate(true), timeoutMs);
    timeout.unref?.();
  }

  child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
  child.stdin.on("error", () => {
    // An early child failure is reported through stderr and its exit status.
  });
  child.stdin.end(code);

  const { exitCode, exitSignal } = await new Promise<{ exitCode: number | null; exitSignal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, exitSignal) => resolve({ exitCode, exitSignal }));
  }).finally(() => {
    signal?.removeEventListener("abort", onAbort);
    if (timeout) clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
  });

  const stdoutPage = stdout.read(stdout.baseOffset, MAX_STREAM_BYTES);
  const stderrPage = stderr.read(stderr.baseOffset, MAX_STREAM_BYTES);
  return {
    exitCode: exitCode ?? undefined,
    signal: exitSignal ?? undefined,
    stdout: stdoutPage.buffer.toString("utf8"),
    stderr: stderrPage.buffer.toString("utf8"),
    stdoutLost: stdout.baseOffset > 0,
    stderrLost: stderr.baseOffset > 0,
    timedOut,
  };
}

function formatResult(result: ExecutionResult): string {
  const sections = [
    `Execution ${result.exitCode === 0 ? "completed" : "failed"}${result.exitCode !== undefined ? ` with exit code ${result.exitCode}` : ""}${result.signal ? ` (${result.signal})` : ""}${result.timedOut ? " after timing out" : ""}.`,
  ];
  if (result.stdout) sections.push(`stdout${result.stdoutLost ? " (earlier output discarded)" : ""}:\n${result.stdout}`);
  if (result.stderr) sections.push(`stderr${result.stderrLost ? " (earlier output discarded)" : ""}:\n${result.stderr}`);
  if (!result.stdout && !result.stderr) sections.push("No output. Use console.log(...) to return information to the agent.");
  return sections.join("\n\n");
}

export function registerExecuteTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "execute",
    label: "Execute",
    description:
      "Transpile and execute TypeScript as a module in an isolated child process in the current working directory. Use this single code tool for filesystem reads, writes, edits, and synchronous command execution. Top-level await, static imports, dynamic imports, exports, CommonJS require(), Bun APIs, Web APIs, Node built-ins, local modules, and installed packages are supported. Print results with console.log. No temporary source file is written.",
    promptSnippet: "Execute code for filesystem, process, and general coding operations",
    promptGuidelines: [
      "Use execute instead of read, edit, write, bash, or powershell.",
      "Submit TypeScript with top-level await when useful.",
      "Use import, dynamic import(), or require() for Node built-ins, packages, and local modules.",
      "Use Bun.file and Bun.write or node:fs APIs for files, and Bun.spawn/Bun.spawnSync for commands.",
      "Print information needed by the agent with console.log because module exports are not returned.",
      "Use task when command execution specifically needs to continue asynchronously in the background.",
    ],
    parameters: ExecuteParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await executeIsolated(
        params.code,
        ctx.cwd,
        signal,
        params.timeoutSeconds ? params.timeoutSeconds * 1_000 : undefined,
      );
      return { content: [{ type: "text", text: formatResult(result) }], details: result };
    },
  });
}
