import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

const enabled = process.env.DIE_RUN_LLM_TESTS === "1";
const binary = resolve(import.meta.dir, "../dist/die");

test.skipIf(!enabled)(
  "GPT-5.6 Luna completes an authenticated die request",
  async () => {
    const expected = "die automated LLM test passed";
    const result = await run([
      binary,
      "--provider",
      "openai-codex",
      "--model",
      "gpt-5.6-luna",
      "--thinking",
      "minimal",
      "--no-session",
      "-p",
      `Reply with exactly: ${expected}`,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  },
  180_000,
);

test.skipIf(!enabled)(
  "GPT-5.6 Luna uses execute for a realistic TypeScript file workflow",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "die-llm-typescript-"));
    const expected = "typescript-tool-automation-passed";
    try {
      const result = await run([
        binary,
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-luna",
        "--thinking",
        "minimal",
        "--no-session",
        "-p",
        `Use execute to create result.txt containing exactly ${expected}, then use execute to read it back. Do not use task. Reply with exactly: ${expected}`,
      ], { cwd: directory });

      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(expected);
      expect(await readFile(join(directory, "result.txt"), "utf8")).toBe(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  180_000,
);

test.skipIf(!enabled)(
  "GPT-5.6 Luna recovers from an execute tool error",
  async () => {
    const expected = "execute-recovery-ok";
    const result = await run([
      binary,
      "--provider", "openai-codex",
      "--model", "gpt-5.6-luna",
      "--thinking", "minimal",
      "--no-session",
      "--mode", "json",
      "-p",
      `Use execute to throw new Error("execute-recovery-probe"). After receiving that error, use a separate execute call to print "${expected}". Do not use other tools. Finally reply exactly ${expected}.`,
    ]);

    expect(result.code).toBe(0);
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line)) as Array<{
      type: string;
      toolName?: string;
      isError?: boolean;
      result?: { content: Array<{ type: string; text?: string }> };
      message?: { role: string; content: Array<{ type: string; text?: string }> };
    }>;
    const executions = events.filter((event) => event.type === "tool_execution_end");
    const failure = executions.findIndex((event) => event.toolName === "execute" && event.isError === true);
    expect(failure).toBeGreaterThanOrEqual(0);
    const errorText = executions[failure].result?.content.map((part) => part.text ?? "").join("") ?? "";
    expect(errorText).toContain("execute-recovery-probe");
    expect(errorText).toContain("<execute-module>");
    expect(errorText).not.toContain("data:text/javascript;base64");
    expect(executions.slice(failure + 1).some((event) =>
      event.toolName === "execute" && event.isError === false &&
      event.result?.content.some((part) => part.text?.includes(expected)),
    )).toBe(true);
    expect(executions.every((event) => event.toolName === "execute")).toBe(true);
    const final = events.filter((event) => event.type === "message_end" && event.message?.role === "assistant").at(-1);
    expect(final?.message?.content.filter((part) => part.type === "text").map((part) => part.text).join("").trim()).toBe(expected);
  },
  180_000,
);

test.skipIf(!enabled)(
  "GPT-5.6 Luna receives automatic asynchronous task completion",
  async () => {
    const expected = "async-task-automation-passed";
    const result = await run([
      binary,
      "--provider",
      "openai-codex",
      "--model",
      "gpt-5.6-luna",
      "--thinking",
      "minimal",
      "--no-session",
      "-p",
      `Use task to spawn the command: sleep 0.5; printf '${expected}'. Do not poll. When its automatic completion notification arrives, reply with exactly: ${expected}`,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  },
  180_000,
);

test.skipIf(!enabled)(
  "GPT-5.6 Luna yields without no-op tools while a command is pending",
  async () => {
    const expected = "pending-task-yield-ok";
    const result = await run([
      binary, "--provider", "openai-codex", "--model", "gpt-5.6-luna",
      "--thinking", "minimal", "--no-session", "--mode", "json", "-p",
      `Use task to run this command: sleep 4; printf '${expected}'. There is no other work to do. After the automatic completion notification arrives, reply exactly ${expected}.`,
    ]);
    expect(result.code).toBe(0);
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line)) as Array<{
      type: string;
      toolName?: string;
      args?: { action?: string; command?: string };
      message?: { role: string; customType?: string; content: string | Array<{ type: string; text?: string }> };
    }>;
    const calls = events.filter((event) => event.type === "tool_execution_start");
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("task");
    expect(calls[0].args?.action).toBe("spawn");
    expect(calls[0].args?.command).toContain(expected);
    const completion = events.findIndex((event) => event.type === "message_end" && event.message?.customType === "task-complete");
    expect(completion).toBeGreaterThanOrEqual(0);
    const final = events.map((event, index) => event.type === "message_end" && event.message?.role === "assistant" ? index : -1).filter((index) => index >= 0).at(-1) ?? -1;
    expect(final).toBeGreaterThan(completion);
    const content = events[final].message?.content;
    expect(Array.isArray(content) ? content.filter((part) => part.type === "text").map((part) => part.text).join("").trim() : content).toBe(expected);
  },
  180_000,
);

test.skipIf(!enabled)(
  "GPT-5.6 Luna delegates through the asynchronous subagent layer",
  async () => {
    const expected = "async-subagent-automation-passed";
    const result = await run([
      binary,
      "--provider",
      "openai-codex",
      "--model",
      "gpt-5.6-luna",
      "--thinking",
      "minimal",
      "--no-session",
      "-p",
      `Use subagent to delegate this prompt: Reply with exactly ${expected}. Do not poll. When its automatic completion arrives, reply with exactly: ${expected}`,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  },
  180_000,
);
