import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { executeIsolated } from "../src/typescript/execution";

const binary = resolve(import.meta.dir, "../dist/die");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("worker handoff acknowledges before intentionally exiting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "die-worker-handoff-"));
  directories.push(directory);
  const sideEffect = join(directory, "after.txt");
  const calls: Array<{ method: string; params: unknown }> = [];

  const result = await executeIsolated(
    `console.log("before"); await handoff("continue in a fresh execute"); await Bun.write(${JSON.stringify(sideEffect)}, "after"); console.log("after");`,
    directory,
    undefined,
    3_000,
    {
      executablePath: binary,
      jobHandler: async (method, params) => {
        calls.push({ method, params });
        return null;
      },
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).toBe("before");
  expect(calls).toEqual([{ method: "handoff", params: { message: "continue in a fresh execute" } }]);
  expect(await Bun.file(sideEffect).exists()).toBe(false);
});

test("a rejected handoff reports the handler error and continues no further", async () => {
  const result = await executeIsolated(
    'console.log("before"); await handoff(42 as any); console.log("after")',
    process.cwd(),
    undefined,
    3_000,
    {
      executablePath: binary,
      jobHandler: async (method, params) => {
        expect(method).toBe("handoff");
        expect(params).toEqual({ message: 42 });
        throw new Error("handoff message must be a string");
      },
    },
  );

  expect(result.exitCode).not.toBe(0);
  expect(result.stdout.trim()).toBe("before");
  expect(result.stdout).not.toContain("after");
  expect(result.stderr).toContain("handoff message must be a string");
});

test("handoff without a bridge retains the unavailable rejection", async () => {
  const result = await executeIsolated('await handoff("next")', process.cwd(), undefined, 3_000, {
    executablePath: binary,
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("bridge is unavailable");
});

test("handoff unwinds cleanup but does not swallow cleanup errors", async () => {
  const result = await executeIsolated(
    'try { await handoff("pending"); } finally { console.log("cleanup"); throw new Error("cleanup failed"); }',
    process.cwd(),
    undefined,
    3000,
    { executablePath: binary, jobHandler: async () => ({ accepted: true }) },
  );
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout.trim()).toBe("cleanup");
  expect(result.stderr).toContain("cleanup failed");
});

test("compiled runner preserves cleanup messages omitted from Error.stack", async () => {
  const result = await executeIsolated(
    `try { await handoff("pending"); } finally {
      const cleanupError = new Error("cleanup failed");
      cleanupError.stack = "Error\\n    at <execute-module>:5:9\\n    at processTicksAndRejections (unknown:7:39)";
      throw cleanupError;
    }`,
    process.cwd(),
    undefined,
    3000,
    { executablePath: binary, jobHandler: async () => ({ accepted: true }) },
  );

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain(
    "Error: cleanup failed\n    at <execute-module>:5:9\n    at processTicksAndRejections (unknown:7:39)",
  );
});
