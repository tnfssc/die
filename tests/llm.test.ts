import { expect, test } from "bun:test";
import { resolve } from "node:path";
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
