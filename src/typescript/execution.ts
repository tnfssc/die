import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { ImageContent } from "@earendil-works/pi-ai";
import { decodeImageChannel, IMAGE_CHANNEL_ENV, MAX_IMAGE_CHANNEL_BYTES } from "./images";
import { BoundedOutputBuffer } from "../tasks/output-buffer";
import { INTERNAL_TYPESCRIPT_RUNNER_ARG } from "./runner";
import { JOB_BRIDGE_ENV, serveJobBridge, openParentJobBridge } from "./job-bridge";

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
  images: ImageContent[];
  imageError?: string;
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
  options: {
    executablePath?: string;
    killGraceMs?: number;
    jobHandler?: (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;
  } = {},
): Promise<ExecutionResult> {
  if (signal?.aborted) {
    return {
      stdout: "",
      stderr: "",
      stdoutLost: false,
      stderrLost: false,
      timedOut: false,
      cancelled: true,
      images: [],
    };
  }
  const childEnv: NodeJS.ProcessEnv = { ...process.env, [IMAGE_CHANNEL_ENV]: "1" };
  if (options.jobHandler) childEnv[JOB_BRIDGE_ENV] = "1";
  else delete childEnv[JOB_BRIDGE_ENV];
  const child = spawn(options.executablePath ?? process.execPath, [INTERNAL_TYPESCRIPT_RUNNER_ARG], {
    cwd,
    env: childEnv,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe", "pipe", ...(options.jobHandler ? ["ipc" as const] : [])],
  });
  const stdout = new BoundedOutputBuffer(MAX_STREAM_BYTES);
  const stderr = new BoundedOutputBuffer(MAX_STREAM_BYTES);
  const imageOutput = new BoundedOutputBuffer(MAX_IMAGE_CHANNEL_BYTES);
  const imagePipe = child.stdio[3] as Readable | undefined;
  const jobPipe = options.jobHandler ? openParentJobBridge(child) : undefined;
  const executionController = new AbortController();
  const jobBridge =
    options.jobHandler && jobPipe ? serveJobBridge(jobPipe, options.jobHandler, executionController.signal) : undefined;
  let imageError: string | undefined;
  let timedOut = false;
  let cancelled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const terminate = (fromTimeout = false) => {
    if (fromTimeout) timedOut = true;
    else cancelled = true;
    executionController.abort();
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
  imagePipe?.on("data", (chunk: Buffer) => {
    if (imageError) return;
    imageOutput.append(chunk);
    if (imageOutput.baseOffset > 0) {
      imageError = "Image output channel exceeded its byte limit";
      signalProcessGroup(child, "SIGKILL");
    }
  });
  imagePipe?.on("error", () => {
    imageError = "Could not read image output channel";
    signalProcessGroup(child, "SIGKILL");
  });
  child.stdout!.on("data", (chunk: Buffer) => stdout.append(chunk));
  child.stderr!.on("data", (chunk: Buffer) => stderr.append(chunk));
  child.stdin!.on("error", () => {
    // Early exits (including EPIPE while sending source) are reported by status.
  });
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  if (timeoutMs) {
    timeout = setTimeout(() => terminate(true), timeoutMs);
    timeout.unref?.();
  }
  child.stdin!.end(code);

  let completed: { exitCode: number | null; exitSignal: NodeJS.Signals | null } | undefined;
  try {
    completed = await completion;
  } finally {
    // Commit response ACKs only at clean worker completion. Until this point a
    // received ACK is provisional and bridge teardown restores notification
    // ownership for any foreground task results.
    jobBridge?.close(completed?.exitCode === 0 && !timedOut && !cancelled);
    executionController.abort();
    signal?.removeEventListener("abort", onAbort);
    if (timeout) clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
    child.stdin!.destroy();
    child.stdout!.destroy();
    child.stderr!.destroy();
    imagePipe?.destroy();
    jobPipe?.destroy();
  }
  const { exitCode, exitSignal } = completed!;

  let images: ImageContent[] = [];
  // Images are atomic results: never attach partial output from failed,
  // cancelled, timed-out, or malformed executions.
  if (exitCode === 0 && !timedOut && !cancelled && !imageError) {
    try {
      images = decodeImageChannel(imageOutput.read(0, MAX_IMAGE_CHANNEL_BYTES).buffer);
    } catch (error) {
      imageError = error instanceof Error ? error.message : "Invalid image output";
    }
  }
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
    images,
    imageError,
  };
}

export function formatResult(result: ExecutionResult): string {
  const status = result.cancelled
    ? "cancelled"
    : result.timedOut
      ? "timed out"
      : result.exitCode === 0 && !result.imageError
        ? "completed"
        : "failed";
  const sections = [
    `Execution ${status}${result.exitCode !== undefined ? ` with exit code ${result.exitCode}` : ""}${result.signal ? ` (${result.signal})` : ""}.`,
  ];
  if (result.stdout)
    sections.push(`stdout${result.stdoutLost ? " (earlier output discarded)" : ""}:\n${result.stdout}`);
  if (result.stderr)
    sections.push(`stderr${result.stderrLost ? " (earlier output discarded)" : ""}:\n${result.stderr}`);
  if (result.stdoutLost || result.stderrLost) {
    sections.push(
      "Output truncated to the last 24,000 bytes / 900 lines per stream. Discarded output is not saved; print a smaller selection or use shell() and jobs.inspect() for cursor-based inspection. Targeted inspection preserves evidence without repeating side effects.",
    );
  }
  if (result.imageError) sections.push(`Image output error: ${result.imageError}`);
  if (result.images.length)
    sections.push(`Returned ${result.images.length} image${result.images.length === 1 ? "" : "s"}.`);
  if (!result.stdout && !result.stderr && !result.images.length && !result.imageError)
    sections.push("No output. Use console.log(...) for text or await emitImage(...) for images.");
  return sections.join("\n\n");
}
