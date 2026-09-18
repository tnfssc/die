import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { inspectDiagnostics } from "../src/diagnostics";
import { executeIsolated, formatResult } from "../src/typescript/execution";
import { registerExecuteTool } from "../src/typescript/extension";
import { makePng } from "./image-fixture";

const binary = resolve(import.meta.dir, "../dist/die");
let directory: string;
const cleanupPids = new Set<number>();

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "die-execution-"));
});
afterEach(async () => {
  for (const pid of cleanupPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  cleanupPids.clear();
  await rm(directory, { recursive: true, force: true });
});

async function execute(code: string, signal?: AbortSignal, timeoutMs = 3_000, executablePath = binary) {
  return executeIsolated(code, directory, signal, timeoutMs, {
    executablePath,
    killGraceMs: 100,
    sessionFile: join(directory, "session.jsonl"),
  });
}

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 3_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for process state");
    await Bun.sleep(10);
  }
}

async function stopped(pid: number) {
  try {
    process.kill(pid, 0);
    // Orphans can remain zombies until the host's init reaps them.
    return process.platform === "linux" && /\) Z /.test(await readFile(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
}

const hang = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); await new Promise(() => {});';

describe("execute process lifecycle and output", () => {
  test("captures separate streams, errors, and early exits", async () => {
    const result = await execute('console.log("out"); console.error("err"); process.exit(7);');
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(formatResult(result)).toContain("failed with exit code 7");
    const failure = await execute('throw new Error("intentional-error")');
    expect(failure.exitCode).toBe(1);
    expect(failure.stderr).toContain("intentional-error");
    expect(failure.stderr).not.toContain("data:text/javascript;base64");
  });

  test("applies a configurable combined output byte limit and reports truncation", async () => {
    const result = await executeIsolated(
      'process.stdout.write("x".repeat(5000)); process.stderr.write("y".repeat(5000));',
      directory,
      undefined,
      3_000,
      {
        executablePath: binary,
        sessionFile: join(directory, "limited-session.jsonl"),
        outputByteLimit: 6_000,
      },
    );
    expect(result.outputBytes).toBe(10_000);
    expect(result.capturedOutputBytes).toBe(6_000);
    expect(result.outputTruncated).toBe(true);
    expect((result.stdoutCapturedBytes ?? 0) + (result.stderrCapturedBytes ?? 0)).toBe(6_000);
    expect(formatResult(result)).toContain("Output capture limit reached: retained 6000 of 10000");
    const capturedFiles = await Promise.all(
      [result.stdoutPath, result.stderrPath]
        .filter((path): path is string => path !== undefined)
        .map((path) => readFile(path)),
    );
    expect(capturedFiles.reduce((bytes, file) => bytes + file.length, 0)).toBe(6_000);
  });

  test("uses the concise no-output fallback", async () => {
    const result = await execute("void 0;");
    expect(formatResult(result)).toBe("Execution completed with exit code 0.\n\nNo output.");
  });

  test("returns short output inline and spills complete streams above 4000 combined characters", async () => {
    const short = await execute('process.stdout.write("x".repeat(3000)); process.stderr.write("y".repeat(1000));');
    expect(short.stdout).toBe("x".repeat(3000));
    expect(short.stderr).toBe("y".repeat(1000));
    expect(short.stdoutPath).toBeUndefined();
    expect(short.stderrPath).toBeUndefined();
    const long = await execute(
      String.raw`process.stdout.write("PREFIX\n" + "x".repeat(5000) + "\nEND"); process.stderr.write("error stream");`,
    );
    expect(long.exitCode).toBe(0);
    expect(long.stdout.length + long.stderr.length).toBeLessThanOrEqual(4000);
    expect(typeof long.stdoutPath).toBe("string");
    expect(typeof long.stderrPath).toBe("string");
    expect(await readFile(long.stdoutPath!, "utf8")).toBe("PREFIX\n" + "x".repeat(5000) + "\nEND");
    expect(await readFile(long.stderrPath!, "utf8")).toBe("error stream");
    expect(formatResult(long)).toContain(long.stdoutPath!);
    expect(formatResult(long)).not.toContain("Discarded output is not saved");
  });

  test("saves long output on failure and preserves output across the spill boundary", async () => {
    const result = await execute(
      'process.stdout.write("first"); await Bun.sleep(10); process.stdout.write("x".repeat(6000)); process.stdout.write("last"); console.error("failure detail"); process.exit(7);',
    );
    expect(result.exitCode).toBe(7);
    expect(await readFile(result.stdoutPath!, "utf8")).toBe("first" + "x".repeat(6000) + "last");
    expect(await readFile(result.stderrPath!, "utf8")).toBe("failure detail\n");
    expect(formatResult(result)).toContain("failed with exit code 7");
  });

  test("does not launch already-cancelled code", async () => {
    const result = await execute('await Bun.write("should-not-exist", "bad")', AbortSignal.abort());
    expect(result.cancelled).toBe(true);
    expect(inspectDiagnostics(result).records).toEqual([
      {
        version: 1,
        generated: expect.any(String),
        component: "jobs",
        code: "caller_aborted",
        outcome: "cancelled",
        cancellation: "caller",
        dispatch: "none",
      },
    ]);
    expect(await Bun.file(join(directory, "should-not-exist")).exists()).toBe(false);
  });

  test("reports spawn failures and tolerates early stdin closure", async () => {
    await expect(execute("console.log(1)", undefined, 3_000, join(directory, "missing"))).rejects.toThrow();
    if (process.platform !== "win32") {
      const result = await execute("x".repeat(2_000_000), undefined, 3_000, "/bin/true");
      expect(result.exitCode).toBe(0);
    }
  });

  test.skipIf(process.platform === "win32")("escalates timeouts when SIGTERM is ignored", async () => {
    const result = await execute(`await Bun.write("ready", "yes"); ${hang}`, undefined, 600);
    expect(await Bun.file(join(directory, "ready")).exists()).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.signal).toBe("SIGKILL");
    expect(formatResult(result)).toContain("Execution timed out");
  });

  test.skipIf(process.platform === "win32")("keeps the first racing termination cause", async () => {
    const afterTimeout = new AbortController();
    setTimeout(() => afterTimeout.abort(), 70).unref?.();
    const timedOut = await execute(hang, afterTimeout.signal, 20);
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.cancelled).toBe(false);
    expect(timedOut.termination?.cause).toBe("timeout");
    expect(Number.isFinite(Date.parse(timedOut.termination!.requestedAt))).toBe(true);
    expect(inspectDiagnostics(timedOut).records).toEqual([
      {
        version: 1,
        generated: expect.any(String),
        component: "jobs",
        code: "timeout",
        outcome: "cancelled",
        cancellation: "timeout",
      },
    ]);

    const beforeTimeout = new AbortController();
    setTimeout(() => beforeTimeout.abort(), 20).unref?.();
    const cancelled = await execute(hang, beforeTimeout.signal, 70);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.timedOut).toBe(false);
    expect(cancelled.termination?.cause).toBe("execute-abort");
    expect(inspectDiagnostics(cancelled).records).toEqual([
      {
        version: 1,
        generated: expect.any(String),
        component: "jobs",
        code: "caller_aborted",
        outcome: "cancelled",
        cancellation: "caller",
      },
    ]);
  });

  test.skipIf(process.platform === "win32")("cancels a running process and escalates", async () => {
    const controller = new AbortController();
    const pending = execute(`await Bun.write("ready", "yes"); ${hang}`, controller.signal);
    try {
      await until(() => Bun.file(join(directory, "ready")).exists());
    } finally {
      controller.abort();
    }
    const result = await pending;
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.signal).toBe("SIGKILL");
  });

  for (const inherited of [true, false]) {
    test.skipIf(process.platform === "win32")(
      `cleans surviving descendants with ${inherited ? "inherited" : "closed"} output pipes`,
      async () => {
        const result = await execute(`
        import { spawn } from "node:child_process";
        const child = spawn("/bin/sh", ["-c", "trap '' TERM; echo ready > child-ready; while :; do sleep 1; done"], {
          stdio: ${JSON.stringify(inherited ? ["ignore", "inherit", "inherit"] : "ignore")},
        });
        child.unref();
        while (!(await Bun.file("child-ready").exists())) await Bun.sleep(10);
        console.log(child.pid);
        process.exit(0);
      `);
        const pid = Number(result.stdout.trim());
        expect(pid).toBeGreaterThan(0);
        cleanupPids.add(pid);
        expect(result.timedOut).toBe(false);
        expect(result.exitCode).toBe(0);
        await until(() => stopped(pid));
      },
    );
  }

  test("bounds huge Unicode output without splitting a retained character", async () => {
    const result = await execute('console.log("🙂".repeat(300_000)); console.error("界".repeat(400_000));');
    expect(result.stdoutLost).toBe(true);
    expect(result.stderrLost).toBe(true);
    expect(result.stdout).not.toContain("�");
    expect(result.stderr).not.toContain("�");
    const text = formatResult(result);
    expect(Buffer.byteLength(text)).toBeLessThan(50_000);
    expect(text).toContain("truncated preview");
    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(4000);
    expect(await readFile(result.stdoutPath!, "utf8")).toBe("🙂".repeat(300_000) + "\n");
    expect(await readFile(result.stderrPath!, "utf8")).toBe("界".repeat(400_000) + "\n");
  });

  test("keeps decoded binary output within the response byte budget", async () => {
    const result = await execute(
      "process.stdout.write(Buffer.alloc(24_000, 255)); process.stderr.write(Buffer.alloc(24_000, 255));",
    );
    expect(Buffer.byteLength(formatResult(result))).toBeLessThan(50_000);
    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(4000);
    expect((await readFile(result.stdoutPath!)).equals(Buffer.alloc(24_000, 255))).toBe(true);
    expect((await readFile(result.stderrPath!)).equals(Buffer.alloc(24_000, 255))).toBe(true);
    expect(result.stdoutLost).toBe(true);
    expect(result.stderrLost).toBe(true);
  });

  test.skipIf(process.platform === "win32")(
    "does not report a cancellation handler's zero exit as success",
    async () => {
      const result = await execute(
        'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000); await new Promise(() => {});',
        undefined,
        600,
      );
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(true);
      expect(formatResult(result)).toContain("Execution timed out");
    },
  );

  test("bounds many short lines and preserves the final output", async () => {
    const result = await execute(
      'console.log("a\\n".repeat(10_000) + "OUT-END"); console.error("b\\n".repeat(10_000) + "ERR-END");',
    );
    expect(result.stdoutLost).toBe(true);
    expect(result.stderrLost).toBe(true);
    expect(result.stdout).toEndWith("OUT-END\n");
    expect(result.stderr).toEndWith("ERR-END\n");
    expect(formatResult(result).split("\n").length).toBeLessThan(2_000);
  });

  test.skipIf(process.platform === "win32")("keeps full captured output after cancellation", async () => {
    const controller = new AbortController();
    const pending = execute(
      'process.stdout.write("begin" + "x".repeat(6000) + "end"); await Bun.write("ready", "yes"); ' + hang,
      controller.signal,
    );
    try {
      await until(() => Bun.file(join(directory, "ready")).exists());
    } finally {
      controller.abort();
    }
    const result = await pending;
    expect(result.cancelled).toBe(true);
    expect(await readFile(result.stdoutPath!, "utf8")).toBe("begin" + "x".repeat(6000) + "end");
    expect(formatResult(result)).toContain(result.stdoutPath!);
  });

  test("tool result exposes session-backed output files to the model", async () => {
    let tool!: ToolDefinition;
    registerExecuteTool(
      {
        registerTool(value: ToolDefinition) {
          tool = value;
        },
        on() {},
      } as unknown as ExtensionAPI,
      undefined,
      binary,
    );
    const sessionFile = join(directory, "real-session.jsonl");
    const ctx = {
      cwd: directory,
      sessionManager: { getSessionFile: () => sessionFile },
    } as unknown as ExtensionContext;
    const result = await tool.execute("long", { code: 'console.log("x".repeat(6000));' }, undefined, undefined, ctx);
    const details = result.details as { stdoutPath: string };
    expect(details.stdoutPath).toStartWith(sessionFile + ".artifacts/");
    expect(await readFile(details.stdoutPath, "utf8")).toBe("x".repeat(6000) + "\n");
    expect(JSON.stringify(result.content)).toContain(details.stdoutPath);
  });

  test("marks cancellation as a tool error and rejects calls after session shutdown", async () => {
    let tool!: ToolDefinition;
    let shutdown!: () => Promise<void>;
    registerExecuteTool({
      registerTool(value: ToolDefinition) {
        tool = value;
      },
      on(_event: string, handler: () => Promise<void>) {
        shutdown = handler;
      },
    } as unknown as ExtensionAPI);
    const ctx = { cwd: directory } as ExtensionContext;
    await expect(
      tool.execute("cancel", { code: "console.log(1)" }, AbortSignal.abort(), undefined, ctx),
    ).rejects.toThrow("Execution cancelled");
    await shutdown();
    await expect(tool.execute("shutdown", { code: "console.log(1)" }, undefined, undefined, ctx)).rejects.toThrow(
      "Execution cancelled",
    );
  });
});

test("unsupported-image results keep the image for Pi to omit and use the concise advisory", async () => {
  let tool!: ToolDefinition;
  registerExecuteTool(
    {
      registerTool(value: ToolDefinition) {
        tool = value;
      },
      on() {},
    } as unknown as ExtensionAPI,
    undefined,
    binary,
  );
  const encoded = makePng().toString("base64");
  const result = await tool.execute(
    "image",
    { code: `await showImage(Buffer.from(${JSON.stringify(encoded)}, "base64"));` },
    undefined,
    undefined,
    { cwd: directory, model: { input: ["text"] } } as unknown as ExtensionContext,
  );
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content[0]!.text).toEndWith("This model can't take images. Images not sent.");
  expect(content[0]!.text).not.toContain("Switch to an image-capable model");
  expect(content.filter((item) => item.type === "image")).toHaveLength(1);
});

test("execute shutdown cancellation is classified and a new session receives a fresh controller", async () => {
  const preempted = await executeIsolated("", process.cwd(), AbortSignal.abort("shutdown"));
  expect(preempted.termination?.cause).toBe("session-shutdown");
  expect(inspectDiagnostics(preempted).records[0]).toMatchObject({ code: "shutdown", cancellation: "shutdown" });
  let tool: any;
  const handlers = new Map<string, Function>();
  registerExecuteTool(
    {
      registerTool(value: any) {
        tool = value;
      },
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
    } as any,
    undefined,
    binary,
  );
  await handlers.get("session_shutdown")!();
  const ctx = { cwd: process.cwd() } as ExtensionContext;
  await expect(tool.execute("closed", { code: "console.log(1)" }, undefined, undefined, ctx)).rejects.toThrow(
    "Execution cancelled",
  );
  handlers.get("session_start")!();
  const result = await tool.execute("fresh", { code: "console.log(2)" }, undefined, undefined, ctx);
  expect(result.details.stdout.trim()).toBe("2");
  expect(result.details.diagnostics).toContainEqual({
    version: 1,
    generated: expect.any(String),
    component: "jobs",
    code: "process_exit",
    outcome: "success",
  });
});

test("registered execute exposes configurable capture limits and truncation details", async () => {
  let tool!: ToolDefinition;
  registerExecuteTool(
    {
      registerTool(value: ToolDefinition) {
        tool = value;
      },
      on() {},
    } as unknown as ExtensionAPI,
    undefined,
    binary,
  );
  expect(tool.description).toContain("10 MiB");
  const result = await tool.execute(
    "capture-budget",
    {
      code: 'process.stdout.write("x".repeat(6000))',
      outputByteLimit: 1000,
    },
    undefined,
    undefined,
    {
      cwd: directory,
      sessionManager: { getSessionFile: () => join(directory, "budget-session.jsonl") },
    } as unknown as ExtensionContext,
  );
  expect(result.details).toMatchObject({
    outputByteLimit: 1000,
    outputBytes: 6000,
    capturedOutputBytes: 1000,
    outputTruncated: true,
  });
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content[0]!.text).toContain("Output capture limit reached");
  expect(content[0]!.text).not.toContain("complete output:");
});
