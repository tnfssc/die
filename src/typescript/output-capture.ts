import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export const EXECUTE_INLINE_OUTPUT_CHARS = 4_000;
/**
 * Default cap for the complete, byte-for-byte stdout/stderr artifacts from one
 * execution. Inline previews have their own small, fixed character cap.
 */
export const DEFAULT_EXECUTE_OUTPUT_BYTE_LIMIT = 10 * 1024 * 1024;
const EXECUTE_INLINE_OUTPUT_LINES_PER_STREAM = 900;

type StreamName = "stdout" | "stderr";

export interface OutputArtifactErrors {
  directory?: string;
  stdout?: string;
  stderr?: string;
}

export interface CapturedOutput {
  stdout: string;
  stderr: string;
  stdoutLost: boolean;
  stderrLost: boolean;
  stdoutPath?: string;
  stderrPath?: string;
  outputArtifactErrors?: OutputArtifactErrors;
  /** Combined stdout/stderr bytes observed, including bytes over the limit. */
  outputBytes: number;
  /** Combined bytes retained in complete-output artifacts/prefixes. */
  capturedOutputBytes: number;
  outputByteLimit: number;
  outputTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutCapturedBytes: number;
  stderrCapturedBytes: number;
}

interface StreamState {
  decoder: StringDecoder;
  prefix: Buffer[];
  preview: string;
  previewTrimmed: boolean;
  handle?: FileHandle;
  path?: string;
  writeError?: string;
  readError?: string;
  bytes: number;
  capturedBytes: number;
  writtenBytes: number;
}

function safeTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let start = text.length - limit;
  // Never begin the preview with the second UTF-16 code unit of a decoded
  // Unicode character. StringDecoder already protects UTF-8 byte boundaries.
  if (start < text.length && /[\uDC00-\uDFFF]/.test(text.charAt(start))) start++;
  return text.slice(start);
}

function safeLineTail(text: string): string {
  const lines = text.split("\n");
  return lines.length > EXECUTE_INLINE_OUTPUT_LINES_PER_STREAM
    ? lines.slice(-EXECUTE_INLINE_OUTPUT_LINES_PER_STREAM).join("\n")
    : text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Captures execute's text streams with a shared byte budget and a separate
 * bounded inline preview. Crossing the preview character budget promotes both
 * streams to files and flushes the bytes retained within the capture budget.
 * Excess bytes are drained for process liveness and counted, never persisted.
 */
export class ExecuteOutputCapture {
  readonly #states: Record<StreamName, StreamState> = {
    stdout: {
      decoder: new StringDecoder("utf8"),
      prefix: [],
      preview: "",
      previewTrimmed: false,
      bytes: 0,
      capturedBytes: 0,
      writtenBytes: 0,
    },
    stderr: {
      decoder: new StringDecoder("utf8"),
      prefix: [],
      preview: "",
      previewTrimmed: false,
      bytes: 0,
      capturedBytes: 0,
      writtenBytes: 0,
    },
  };
  readonly #sessionFile?: string;
  readonly #outputByteLimit: number;
  // Budget-selected bytes; failed storage must not refund the capture allowance.
  #capturedOutputBytes = 0;
  #outputBytes = 0;
  #characterCount = 0;
  #spilled = false;
  #directory?: string;
  #directoryError?: string;
  #operations = Promise.resolve();

  constructor(options: { sessionFile?: string; outputByteLimit?: number } = {}) {
    const limit = options.outputByteLimit ?? DEFAULT_EXECUTE_OUTPUT_BYTE_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError("outputByteLimit must be a non-negative safe integer");
    this.#outputByteLimit = limit;
    this.#sessionFile =
      typeof options.sessionFile === "string" && options.sessionFile.length ? resolve(options.sessionFile) : undefined;
  }

  async consume(name: StreamName, readable: Readable): Promise<void> {
    try {
      for await (const value of readable) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        await this.#enqueue(() => this.#append(name, chunk));
      }
    } catch (error) {
      await this.#enqueue(async () => {
        this.#states[name].readError = `Could not read complete ${name} output: ${errorMessage(error)}`;
      });
      throw error;
    } finally {
      // Flush the decoder even when the stream pump rejects. result() will
      // subsequently close any artifact handle opened before that rejection.
      await this.#enqueue(() => this.#end(name));
    }
  }

  async result(): Promise<CapturedOutput> {
    await this.#operations;
    await Promise.all(
      (Object.values(this.#states) as StreamState[]).map(async (state) => {
        if (!state.handle) return;
        try {
          await state.handle.close();
        } catch (error) {
          state.writeError ??= `Could not close output file: ${errorMessage(error)}`;
        } finally {
          state.handle = undefined;
        }
      }),
    );

    const stdoutPreview = this.#states.stdout.preview;
    const stderrPreview = this.#states.stderr.preview;
    let stdoutLimit = stdoutPreview.length;
    let stderrLimit = stderrPreview.length;
    if (stdoutLimit + stderrLimit > EXECUTE_INLINE_OUTPUT_CHARS) {
      stdoutLimit = Math.min(stdoutLimit, Math.floor(EXECUTE_INLINE_OUTPUT_CHARS / 2));
      stderrLimit = Math.min(stderrLimit, EXECUTE_INLINE_OUTPUT_CHARS - stdoutLimit);
      let remaining = EXECUTE_INLINE_OUTPUT_CHARS - stdoutLimit - stderrLimit;
      const stdoutExtra = Math.min(remaining, stdoutPreview.length - stdoutLimit);
      stdoutLimit += stdoutExtra;
      remaining -= stdoutExtra;
      stderrLimit += Math.min(remaining, stderrPreview.length - stderrLimit);
    }

    const stdoutTail = safeTail(stdoutPreview, stdoutLimit);
    const stderrTail = safeTail(stderrPreview, stderrLimit);
    const stdout = this.#spilled ? safeLineTail(stdoutTail) : stdoutTail;
    const stderr = this.#spilled ? safeLineTail(stderrTail) : stderrTail;
    const stdoutLost = this.#states.stdout.previewTrimmed || stdout.length < stdoutPreview.length;
    const stderrLost = this.#states.stderr.previewTrimmed || stderr.length < stderrPreview.length;
    const errors: OutputArtifactErrors = {
      ...(this.#directoryError ? { directory: this.#directoryError } : {}),
      ...(this.#states.stdout.writeError || this.#states.stdout.readError
        ? { stdout: [this.#states.stdout.writeError, this.#states.stdout.readError].filter(Boolean).join("; ") }
        : {}),
      ...(this.#states.stderr.writeError || this.#states.stderr.readError
        ? { stderr: [this.#states.stderr.writeError, this.#states.stderr.readError].filter(Boolean).join("; ") }
        : {}),
    };
    const capturedBytes = (name: StreamName) =>
      this.#spilled ? this.#states[name].writtenBytes : this.#states[name].capturedBytes;
    return {
      stdout,
      stderr,
      stdoutLost,
      stderrLost,
      outputBytes: this.#outputBytes,
      capturedOutputBytes: capturedBytes("stdout") + capturedBytes("stderr"),
      outputByteLimit: this.#outputByteLimit,
      outputTruncated: this.#outputBytes > this.#capturedOutputBytes,
      stdoutBytes: this.#states.stdout.bytes,
      stderrBytes: this.#states.stderr.bytes,
      stdoutCapturedBytes: capturedBytes("stdout"),
      stderrCapturedBytes: capturedBytes("stderr"),
      ...(this.#states.stdout.path ? { stdoutPath: this.#states.stdout.path } : {}),
      ...(this.#states.stderr.path ? { stderrPath: this.#states.stderr.path } : {}),
      ...(Object.keys(errors).length ? { outputArtifactErrors: errors } : {}),
    };
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const current = this.#operations.then(operation);
    // Capture failures are converted to explicit result metadata by the
    // operation itself, so keep the queue usable for the other stream.
    this.#operations = current.catch(() => {});
    return current;
  }

  async #append(name: StreamName, chunk: Buffer): Promise<void> {
    const state = this.#states[name];
    state.bytes += chunk.length;
    this.#outputBytes += chunk.length;

    // stdout and stderr share this allowance. Serialization through #enqueue
    // makes the retained prefix deterministic in the order chunks arrive.
    const allowance = Math.max(0, this.#outputByteLimit - this.#capturedOutputBytes);
    const retained = chunk.subarray(0, Math.min(chunk.length, allowance));
    state.capturedBytes += retained.length;
    this.#capturedOutputBytes += retained.length;

    const wasSpilled = this.#spilled;
    if (!wasSpilled && retained.length) state.prefix.push(Buffer.from(retained));
    this.#addDecoded(state, state.decoder.write(chunk));
    if (!this.#spilled && this.#characterCount > EXECUTE_INLINE_OUTPUT_CHARS) await this.#startSpill();
    if (wasSpilled) await this.#write(name, retained);
  }

  async #end(name: StreamName): Promise<void> {
    const state = this.#states[name];
    this.#addDecoded(state, state.decoder.end());
    if (!this.#spilled && this.#characterCount > EXECUTE_INLINE_OUTPUT_CHARS) await this.#startSpill();
  }

  #addDecoded(state: StreamState, text: string): void {
    if (!text) return;
    this.#characterCount = Math.min(EXECUTE_INLINE_OUTPUT_CHARS + 1, this.#characterCount + text.length);
    const retained = state.preview + text;
    if (retained.length > EXECUTE_INLINE_OUTPUT_CHARS) {
      state.preview = safeTail(retained, EXECUTE_INLINE_OUTPUT_CHARS);
      state.previewTrimmed = true;
    } else {
      state.preview = retained;
    }
  }

  async #startSpill(): Promise<void> {
    this.#spilled = true;
    // A preview-only capture needs no empty directory or misleading file path.
    if (this.#capturedOutputBytes === 0) return;
    try {
      if (this.#sessionFile) {
        const root = join(dirname(this.#sessionFile), `${basename(this.#sessionFile)}.artifacts`);
        await mkdir(root, { recursive: true, mode: 0o700 });
        this.#directory = join(root, `execute-${Date.now()}-${randomUUID()}`);
      } else {
        this.#directory = join(tmpdir(), `die-execute-${Date.now()}-${randomUUID()}`);
      }
      await mkdir(this.#directory, { mode: 0o700 });
    } catch (error) {
      this.#directoryError = `Could not create execute output directory: ${errorMessage(error)}`;
      for (const state of Object.values(this.#states)) state.prefix = [];
      return;
    }
    for (const name of ["stdout", "stderr"] as const) {
      const state = this.#states[name];
      if (state.capturedBytes === 0) continue;
      await this.#open(name);
      for (const chunk of state.prefix) await this.#write(name, chunk);
      state.prefix = [];
    }
  }

  async #open(name: StreamName): Promise<void> {
    const state = this.#states[name];
    if (state.handle || state.writeError || !this.#directory) return;
    const path = join(this.#directory, `${name}.log`);
    try {
      state.handle = await open(path, "wx", 0o600);
      state.path = path;
    } catch (error) {
      state.writeError = `Could not create ${name} output file: ${errorMessage(error)}`;
    }
  }

  async #write(name: StreamName, chunk: Buffer): Promise<void> {
    if (!chunk.length || this.#directoryError) return;
    const state = this.#states[name];
    if (!state.handle && !state.writeError) await this.#open(name);
    if (!state.handle || state.writeError) return;
    try {
      let offset = 0;
      while (offset < chunk.length) {
        const written = await state.handle.write(chunk, offset, chunk.length - offset, null);
        if (written.bytesWritten <= 0) throw new Error("write returned zero bytes");
        offset += written.bytesWritten;
        state.writtenBytes += written.bytesWritten;
      }
    } catch (error) {
      state.writeError = `Could not write complete ${name} output: ${errorMessage(error)}`;
      try {
        await state.handle.close();
      } catch {}
      state.handle = undefined;
    }
  }
}
