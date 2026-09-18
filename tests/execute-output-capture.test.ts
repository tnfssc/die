import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { DEFAULT_EXECUTE_OUTPUT_BYTE_LIMIT, ExecuteOutputCapture } from "../src/typescript/output-capture";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "die-capture-test-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function capture(
  stdout: Array<Buffer | string>,
  stderr: Array<Buffer | string> = [],
  sessionFile = join(directory, "session.jsonl"),
) {
  const output = new ExecuteOutputCapture({ sessionFile });
  await Promise.all([output.consume("stdout", Readable.from(stdout)), output.consume("stderr", Readable.from(stderr))]);
  return output.result();
}

test("4000 combined characters stay inline without files, including many short lines", async () => {
  const result = await capture(["\n".repeat(3000)], ["\u754C".repeat(1000)]);
  expect(result.stdout).toBe("\n".repeat(3000));
  expect(result.stderr).toBe("\u754C".repeat(1000));
  expect(result.stdoutLost).toBe(false);
  expect(result.stderrLost).toBe(false);
  expect(result.stdoutPath).toBeUndefined();
  expect(result.stderrPath).toBeUndefined();
  expect(await readdir(directory)).toEqual([]);
});

test("4001 combined characters spill both complete streams to unique session files", async () => {
  const results = await Promise.all([capture(["x".repeat(3000)], ["y".repeat(1001)]), capture(["z".repeat(4001)])]);
  const [first, second] = results;
  expect(first.stdout.length + first.stderr.length).toBeLessThanOrEqual(4000);
  expect(await readFile(first.stdoutPath!, "utf8")).toBe("x".repeat(3000));
  expect(await readFile(first.stderrPath!, "utf8")).toBe("y".repeat(1001));
  expect(await readFile(second.stdoutPath!, "utf8")).toBe("z".repeat(4001));
  expect(first.stdoutPath).not.toBe(second.stdoutPath);
  expect(first.stdoutPath).toStartWith(join(directory, "session.jsonl.artifacts") + "/");
  expect(second.stderrPath).toBeUndefined();
});

test("preserves UTF-8 bytes split across chunks at the spill boundary", async () => {
  const face = Buffer.from("\u{1f642}");
  const result = await capture([
    "x".repeat(3999),
    face.subarray(0, 1),
    face.subarray(1, 3),
    face.subarray(3),
    "\u754C".repeat(4000),
  ]);
  expect(result.stdout).not.toContain("\uFFFD");
  expect(result.stdout.length).toBeLessThanOrEqual(4000);
  expect(await readFile(result.stdoutPath!, "utf8")).toBe("x".repeat(3999) + "\u{1f642}" + "\u754C".repeat(4000));
});

test("flushes incomplete UTF-8 at stream end before deciding whether to spill", async () => {
  const result = await capture(["x".repeat(4000), Buffer.from([0xf0])]);
  expect(result.stdoutLost).toBe(true);
  expect(
    (await readFile(result.stdoutPath!)).equals(Buffer.concat([Buffer.from("x".repeat(4000)), Buffer.from([0xf0])])),
  ).toBe(true);
});

test("reports an unwritable artifact location without claiming complete files exist", async () => {
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(sessionFile + ".artifacts", "blocks directory creation");
  const result = await capture(["first", "x".repeat(5000), "last"], [], sessionFile);
  expect(result.stdout).toEndWith("last");
  expect(result.stdoutPath).toBeUndefined();
  expect(result.outputArtifactErrors?.directory).toContain("Could not create");
  expect(result.capturedOutputBytes).toBe(0);
  expect(result.stdoutCapturedBytes).toBe(0);
  expect(result.outputTruncated).toBe(false); // Storage error, not byte-limit exhaustion.
  expect(result.stdout.length).toBeLessThanOrEqual(4000);
});

test("standalone captures use discoverable temporary files that survive completion", async () => {
  const result = await capture(["x".repeat(5000)], [], "");
  expect(basename(dirname(result.stdoutPath!))).toStartWith("die-execute-");
  try {
    expect(await readFile(result.stdoutPath!, "utf8")).toBe("x".repeat(5000));
    if (process.platform !== "win32") {
      expect((await stat(dirname(result.stdoutPath!))).mode & 0o077).toBe(0);
      expect((await stat(result.stdoutPath!)).mode & 0o077).toBe(0);
    }
  } finally {
    await rm(dirname(result.stdoutPath!), { recursive: true, force: true });
  }
});

test("enforces one explicit byte budget across stdout and stderr", async () => {
  const output = new ExecuteOutputCapture({
    sessionFile: join(directory, "budget-session.jsonl"),
    outputByteLimit: 4_500,
  });
  await output.consume("stdout", Readable.from(["x".repeat(4_001)]));
  await output.consume("stderr", Readable.from(["y".repeat(1_000)]));
  const result = await output.result();

  expect(result).toMatchObject({
    outputByteLimit: 4_500,
    outputBytes: 5_001,
    capturedOutputBytes: 4_500,
    outputTruncated: true,
    stdoutBytes: 4_001,
    stdoutCapturedBytes: 4_001,
    stderrBytes: 1_000,
    stderrCapturedBytes: 499,
  });
  expect(await readFile(result.stdoutPath!, "utf8")).toBe("x".repeat(4_001));
  expect(await readFile(result.stderrPath!, "utf8")).toBe("y".repeat(499));
});

test.skipIf(process.platform !== "linux")("closes artifact handles when a stream pump rejects", async () => {
  const output = new ExecuteOutputCapture({ sessionFile: join(directory, "reject-session.jsonl") });
  const broken = Readable.from(
    (async function* () {
      yield "x".repeat(5_000);
      throw new Error("pump failed");
    })(),
  );
  await expect(output.consume("stdout", broken)).rejects.toThrow("pump failed");
  await output.consume("stderr", Readable.from([]));
  const result = await output.result();
  expect(result.outputArtifactErrors?.stdout).toContain("pump failed");

  const descriptors = await readdir("/proc/self/fd");
  const links = await Promise.all(
    descriptors.map(async (descriptor) => {
      try {
        return await import("node:fs/promises").then(({ readlink }) => readlink(`/proc/self/fd/${descriptor}`));
      } catch {
        return "";
      }
    }),
  );
  expect(links).not.toContain(result.stdoutPath!);
});

test("default capture budget bounds artifacts while continuing to drain output", async () => {
  const output = new ExecuteOutputCapture({ sessionFile: join(directory, "default-budget.jsonl") });
  const chunk = Buffer.alloc(1024 * 1024, 120);
  await output.consume(
    "stdout",
    Readable.from(
      (function* () {
        for (let index = 0; index < 12; index++) yield chunk;
      })(),
    ),
  );
  const result = await output.result();
  expect(result.outputByteLimit).toBe(DEFAULT_EXECUTE_OUTPUT_BYTE_LIMIT);
  expect(result.outputBytes).toBe(12 * chunk.length);
  expect(result.capturedOutputBytes).toBe(DEFAULT_EXECUTE_OUTPUT_BYTE_LIMIT);
  expect(result.outputTruncated).toBe(true);
  expect((await stat(result.stdoutPath!)).size).toBe(DEFAULT_EXECUTE_OUTPUT_BYTE_LIMIT);
  expect(result.stdout.length).toBeLessThanOrEqual(4000);
});

test("zero capture budget is explicit and preserves the separate inline preview", async () => {
  const output = new ExecuteOutputCapture({ sessionFile: join(directory, "zero-budget.jsonl"), outputByteLimit: 0 });
  await output.consume("stdout", Readable.from(["hello"]));
  const result = await output.result();
  expect(result).toMatchObject({ stdout: "hello", outputBytes: 5, capturedOutputBytes: 0, outputTruncated: true });
  expect(result.stdoutPath).toBeUndefined();
});

test("capture limits count UTF-8 bytes, not characters", async () => {
  const output = new ExecuteOutputCapture({ sessionFile: join(directory, "utf8-budget.jsonl"), outputByteLimit: 6 });
  await output.consume("stdout", Readable.from(["界界"]));
  const result = await output.result();
  expect(result).toMatchObject({ stdout: "界界", outputBytes: 6, capturedOutputBytes: 6, outputTruncated: false });
});

test("zero capture budget creates no spill directories or paths above the preview threshold", async () => {
  const output = new ExecuteOutputCapture({ sessionFile: join(directory, "zero-spill.jsonl"), outputByteLimit: 0 });
  await output.consume("stdout", Readable.from(["x".repeat(5000)]));
  await output.consume("stderr", Readable.from(["y".repeat(5000)]));
  const result = await output.result();
  expect(result.outputTruncated).toBe(true);
  expect(result.capturedOutputBytes).toBe(0);
  expect(result.stdoutPath).toBeUndefined();
  expect(result.stderrPath).toBeUndefined();
  expect(await readdir(directory)).toEqual([]);
});

test("streams arriving after capture budget exhaustion do not create empty artifacts", async () => {
  const output = new ExecuteOutputCapture({ sessionFile: join(directory, "exhausted.jsonl"), outputByteLimit: 4001 });
  await output.consume("stdout", Readable.from(["x".repeat(4001)]));
  await output.consume("stderr", Readable.from(["y".repeat(5000)]));
  const result = await output.result();
  expect((await stat(result.stdoutPath!)).size).toBe(4001);
  expect(result.stderrCapturedBytes).toBe(0);
  expect(result.stderrPath).toBeUndefined();
  expect(await readdir(dirname(result.stdoutPath!))).toEqual(["stdout.log"]);
});
