import { spawn } from "node:child_process";
import { BoundedOutputBuffer } from "../tasks/output-buffer";
import { INTERNAL_TYPESCRIPT_RUNNER_ARG } from "./runner";

// Leave room for stream labels, status, and truncation guidance within 50 KB /
// 2,000 lines overall. Details retain the same bounded output as model content.
const MAX_STREAM_BYTES = 24_000;
const MAX_STREAM_LINES = 900;

export interface ExecutionResult {
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  stdoutLost: boolean;
  stderrLost: boolean;
  timedOut: boolean;
  cancelled: boolean;
}

function signalProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process or its group may already have exited.
  }
}

function streamTail(output: BoundedOutputBuffer): { text: string; lost: boolean } {
  const { buffer } = output.read(output.baseOffset, MAX_STREAM_BYTES);
  let start = 0;
  // Retaining a byte tail can cut through the first UTF-8 character.
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
  // Invalid UTF-8 expands to three-byte replacement characters. Re-bound the
  // decoded text as well, so binary output cannot bypass the response budget.
  const decoded = Buffer.from(buffer.subarray(start).toString("utf8"));
  let decodedStart = Math.max(0, decoded.length - MAX_STREAM_BYTES);
  while (decodedStart < decoded.length && (decoded[decodedStart] & 0xc0) === 0x80) decodedStart++;
  const lines = decoded.subarray(decodedStart).toString("utf8").split("\n");
  return {
    text: lines.slice(-MAX_STREAM_LINES).join("\n"),
    lost: output.baseOffset > 0 || start > 0 || decodedStart > 0 || lines.length > MAX_STREAM_LINES,
  };
}

export async function executeIsolated(
  code: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs?: number,
  options: { executablePath?: string; killGraceMs?: number } = {},
): Promise<ExecutionResult> {
  if (signal?.aborted) {
    return { stdout: "", stderr: "", stdoutLost: false, stderrLost: false, timedOut: false, cancelled: true };
  }
  const child = spawn(options.executablePath ?? process.execPath, [INTERNAL_TYPESCRIPT_RUNNER_ARG], {
    cwd,
    env: process.env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = new BoundedOutputBuffer(MAX_STREAM_BYTES);
  const stderr = new BoundedOutputBuffer(MAX_STREAM_BYTES);
  let timedOut = false;
  let cancelled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const terminate = (fromTimeout = false) => {
    if (fromTimeout) timedOut = true;
    else cancelled = true;
    signalProcessGroup(child, "SIGTERM");
    killTimer ??= setTimeout(() => signalProcessGroup(child, "SIGKILL"), options.killGraceMs ?? 5_000);
    killTimer.unref?.();
  };
  const onAbort = () => terminate();
  // Install completion handlers before writing source or acting on cancellation.
  const completion = new Promise<{ exitCode: number | null; exitSignal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => {
      // execute is synchronous work, not a background-task launcher. Reap any
      // remaining group members even if the leader exited successfully or its
      // descendants closed their stdio. Otherwise close can hang indefinitely.
      signalProcessGroup(child, "SIGKILL");
    });
    child.once("close", (exitCode, exitSignal) => resolve({ exitCode, exitSignal }));
  });
  child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
  child.stdin.on("error", () => {
    // Early exits (including EPIPE while sending source) are reported by status.
  });
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  if (timeoutMs) {
    timeout = setTimeout(() => terminate(true), timeoutMs);
    timeout.unref?.();
  }
  child.stdin.end(code);

  const { exitCode, exitSignal } = await completion.finally(() => {
    signal?.removeEventListener("abort", onAbort);
    if (timeout) clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  });

  const out = streamTail(stdout);
  const err = streamTail(stderr);
  return {
    exitCode: exitCode ?? undefined,
    signal: exitSignal ?? undefined,
    stdout: out.text,
    stderr: err.text,
    stdoutLost: out.lost,
    stderrLost: err.lost,
    timedOut,
    cancelled,
  };
}

export function formatResult(result: ExecutionResult): string {
  const status = result.cancelled ? "cancelled" : result.timedOut ? "timed out" : result.exitCode === 0 ? "completed" : "failed";
  const sections = [
    `Execution ${status}${result.exitCode !== undefined ? ` with exit code ${result.exitCode}` : ""}${result.signal ? ` (${result.signal})` : ""}.`,
  ];
  if (result.stdout) sections.push(`stdout${result.stdoutLost ? " (earlier output discarded)" : ""}:\n${result.stdout}`);
  if (result.stderr) sections.push(`stderr${result.stderrLost ? " (earlier output discarded)" : ""}:\n${result.stderr}`);
  if (result.stdoutLost || result.stderrLost) {
    sections.push("Output truncated to the last 24,000 bytes / 900 lines per stream. Discarded output is not saved; print a smaller selection or use task for cursor-based inspection. Do not rerun side-effecting code merely to recover output.");
  }
  if (!result.stdout && !result.stderr) sections.push("No output. Use console.log(...) to return information to the agent.");
  return sections.join("\n\n");
}
