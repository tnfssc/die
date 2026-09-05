import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { executeIsolated, formatResult } from "../src/typescript/execution";
import { registerExecuteTool } from "../src/typescript/extension";

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

function execute(code: string, signal?: AbortSignal, timeoutMs = 3_000, executablePath = binary) {
  return executeIsolated(code, directory, signal, timeoutMs, { executablePath, killGraceMs: 100 });
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

  test("does not launch already-cancelled code", async () => {
    const result = await execute('await Bun.write("should-not-exist", "bad")', AbortSignal.abort());
    expect(result.cancelled).toBe(true);
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
    expect(text).toContain("Discarded output is not saved");
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(24_000);
  });

  test("keeps decoded binary output within the response byte budget", async () => {
    const result = await execute(
      "process.stdout.write(Buffer.alloc(24_000, 255)); process.stderr.write(Buffer.alloc(24_000, 255));",
    );
    expect(Buffer.byteLength(formatResult(result))).toBeLessThan(50_000);
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
