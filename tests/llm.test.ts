import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";
import { makePng } from "./image-fixture";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

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
      const result = await run(
        [
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
        ],
        { cwd: directory },
      );

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
  "GPT-5.6 Luna sees an image returned by execute",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "die-llm-image-"));
    const png = makePng(320, 240, (x, y) =>
      y < 120 ? (x < 160 ? [255, 0, 0] : [0, 255, 0]) : x < 160 ? [0, 0, 255] : [255, 255, 0],
    );
    try {
      await Bun.write(join(directory, "picture.png"), png);
      const result = await run(
        [
          binary,
          "--provider",
          "openai-codex",
          "--model",
          "gpt-5.6-luna",
          "--thinking",
          "minimal",
          "--no-session",
          "--mode",
          "json",
          "-p",
          "Use execute to view picture.png with await emitImage('picture.png'). Then name the color in the lower-right quadrant. Reply with one lowercase color word. Do not decode pixels or use other tools; inspect the returned image visually.",
        ],
        { cwd: directory },
      );
      expect(result.code).toBe(0);
      const events = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)) as Array<{
        type: string;
        toolName?: string;
        isError?: boolean;
        result?: { content: (TextContent | ImageContent)[]; details?: unknown };
        message?: { role: string; content: (TextContent | ImageContent)[] };
      }>;
      const tools = events.filter((event) => event.type === "tool_execution_end");
      expect(tools).toHaveLength(1);
      expect(tools[0].toolName).toBe("execute");
      expect(tools[0].isError).toBe(false);
      expect(tools[0].result?.content.filter((part) => part.type === "image")).toEqual([
        { type: "image", mimeType: "image/png", data: png.toString("base64") },
      ]);
      expect(JSON.stringify(tools[0].result?.details)).not.toContain(png.toString("base64"));
      const final = events
        .filter((event) => event.type === "message_end" && event.message?.role === "assistant")
        .at(-1);
      expect(
        final?.message?.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim(),
      ).toBe("yellow");
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
      "--provider",
      "openai-codex",
      "--model",
      "gpt-5.6-luna",
      "--thinking",
      "minimal",
      "--no-session",
      "--mode",
      "json",
      "-p",
      `Use execute to throw new Error("execute-recovery-probe"). After receiving that error, use a separate execute call to print "${expected}". Do not use other tools. Finally reply exactly ${expected}.`,
    ]);

    expect(result.code).toBe(0);
    const events = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<{
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
    expect(
      executions
        .slice(failure + 1)
        .some(
          (event) =>
            event.toolName === "execute" &&
            event.isError === false &&
            event.result?.content.some((part) => part.text?.includes(expected)),
        ),
    ).toBe(true);
    expect(executions.every((event) => event.toolName === "execute")).toBe(true);
    const final = events.filter((event) => event.type === "message_end" && event.message?.role === "assistant").at(-1);
    expect(
      final?.message?.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim(),
    ).toBe(expected);
  },
  180_000,
);

for (const waitSeconds of [1, 0])
  test.skipIf(!enabled)(
    "GPT-5.6 Luna uses unified shell helper " + (waitSeconds ? "inline" : "in background"),
    async () => {
      const marker = "unified-shell-ok";
      const command = waitSeconds ? "printf " + marker : "sleep 3; printf " + marker;
      const result = await run([
        binary,
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-luna",
        "--thinking",
        "minimal",
        "--no-session",
        "--mode",
        "json",
        "-p",
        "Use execute exactly once to run console.log(JSON.stringify(await shell(" +
          JSON.stringify(command) +
          ", {waitSeconds:" +
          waitSeconds +
          "}))). If it backgrounds, yield without polling and wait for completion. Then reply exactly " +
          marker +
          ". Do not call other helpers or tools.",
      ]);
      expect(result.code).toBe(0);
      const events = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const calls = events.filter((e) => e.type === "tool_execution_start");
      expect(calls).toHaveLength(1);
      expect(calls[0].toolName).toBe("execute");
      const completions = events.filter((e) => e.type === "message_end" && e.message?.customType === "task-complete");
      expect(completions).toHaveLength(waitSeconds ? 0 : 1);
      const final = events.filter((e) => e.type === "message_end" && e.message?.role === "assistant").at(-1);
      expect(
        final.message.content
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("")
          .trim(),
      ).toBe(marker);
    },
    120_000,
  );

test.skipIf(!enabled)(
  "GPT-5.6 Luna unified subagent diagnostics persist tool history",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "die-unified-agent-")),
      marker = "unified-agent-ok";
    try {
      const prompt =
        "Use execute once to console.log('" +
        marker +
        "'), then reply exactly " +
        marker +
        ". Do not delegate or edit files.";
      const code =
        "console.log(JSON.stringify(await subagent(" +
        JSON.stringify({ type: "normal", prompt, waitSeconds: 0, timeoutSeconds: 60 }) +
        ")))";
      const result = await run([
        binary,
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-luna",
        "--thinking",
        "minimal",
        "--session",
        join(directory, "parent.jsonl"),
        "--mode",
        "json",
        "-p",
        "Use execute exactly once with this code: " +
          code +
          ". Then yield without polling. When completion arrives, reply exactly " +
          marker +
          ".",
      ]);
      expect(result.code).toBe(0);
      const events = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const launch = events.find((e) => e.type === "tool_execution_end" && e.toolName === "execute");
      if (launch?.isError)
        console.log(
          "Subagent launch error:",
          launch.result?.content
            ?.filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n"),
        );
      expect(launch?.isError).toBe(false);
      const job = JSON.parse(launch.result.details.stdout);
      expect(job.agent.sessionFile).toStartWith(directory);
      const entries = (await readFile(job.agent.sessionFile, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(entries.some((e) => e.type === "custom" && e.customType === "die-agent")).toBe(true);
      expect(
        entries.some(
          (e) => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "execute",
        ),
      ).toBe(true);
      const completed = events.find((e) => e.type === "message_end" && e.message?.customType === "task-complete");
      expect(completed?.message?.content).toContain(marker);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  150_000,
);
