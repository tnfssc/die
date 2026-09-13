import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { ExecuteOutputCapture } from "../src/typescript/output-capture";

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
