import { expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { completionDiagnosticDetails } from "../src/tasks/extension";
import { registerExecuteTool } from "../src/typescript/extension";
import {
  completionPreview,
  executeInputPreview,
  executeOutputPreview,
  foldedRows,
  type ExecutePreviewState,
} from "../src/ui/execution-previews";

const theme = { fg: (_color: string, text: string) => text } as any;
const code = 'console.log("first");\nconsole.log("last");';
const success = {
  content: [{ type: "text", text: "Execution completed with exit code 0.\n\nstdout:\nfirst\nlast" }],
  details: { exitCode: 0, stdout: "first\nlast", stderr: "", images: [] },
};

test("collapsed execute call and settled result are deterministic single rows", () => {
  expect(executeInputPreview(code, false, theme, undefined, true).render(100)).toEqual([
    '… Execute running · console.log("first"); console.log("last");',
  ]);
  expect(executeOutputPreview(success, false, false, theme, code).render(120)).toEqual([
    '✓ Execution completed · exit 0 · console.log("first"); console.log("last");',
  ]);
});

test("shared renderer state prevents Pi call/result composition from adding a second row", () => {
  const state: ExecutePreviewState = {};
  const call = executeInputPreview(code, false, theme, state, true);
  expect(call.render(100)).toHaveLength(1);
  const result = executeOutputPreview(success, false, false, theme, code, state);
  expect([...call.render(100), ...result.render(100)]).toHaveLength(1);
});

test("execute previews apply configurable horizontal padding and deduct it from content width", () => {
  for (const padding of [0, 1, 2]) {
    const call = executeInputPreview("x".repeat(80), false, theme, undefined, true, padding).render(12);
    const result = executeOutputPreview(success, false, false, theme, "x".repeat(80), undefined, padding).render(12);
    for (const row of [...call, ...result]) {
      expect(row.startsWith(" ".repeat(padding))).toBe(true);
      expect(visibleWidth(row)).toBeLessThanOrEqual(12);
    }
    expect(stripTerminalSequences(call[0]).slice(padding)).toStartWith("…");
    expect(stripTerminalSequences(result[0]).slice(padding)).toStartWith("✓");
  }
});

test("execute tool wiring supplies configured padding to call and result renderers", () => {
  const context = {
    args: { code },
    cwd: "/fixture",
    expanded: false,
    executionStarted: true,
    isError: false,
    state: {},
  };
  type PreviewTool = {
    renderCall(args: typeof context.args, renderTheme: typeof theme, renderContext: typeof context): Component;
    renderResult(
      result: typeof success,
      options: { expanded: boolean },
      renderTheme: typeof theme,
      renderContext: typeof context,
    ): Component;
  };
  let tool: PreviewTool | undefined;
  registerExecuteTool(
    {
      on() {},
      registerTool(definition: unknown) {
        tool = definition as PreviewTool;
      },
    } as unknown as ExtensionAPI,
    undefined,
    undefined,
    () => 2,
  );
  if (!tool) throw new Error("execute tool was not registered");
  expect(tool.renderCall(context.args, theme, context).render(80)[0]).toStartWith("  … Execute");
  expect(tool.renderResult(success, { expanded: false }, theme, context).render(80)[0]).toStartWith("  ✓ Execution");
});

test("expanded execute keeps source/result grouping inside configured padding", () => {
  const rows = executeOutputPreview(success, true, false, theme, code, undefined, 2).render(32);
  expect(rows.some((row) => row.trim().length === 0)).toBe(true);
  for (const row of rows) expect(row.startsWith("  ")).toBe(true);
  expect(rows.map((row) => row.slice(2)).join("\n")).toContain("stdout:");
});

test("expanded execute includes the full command and output", () => {
  const rendered = executeOutputPreview(success, true, false, theme, code)
    .render(100)
    .map((row) => row.trimEnd())
    .join("\n");
  expect(rendered).toContain('console.log("first")');
  expect(rendered).toContain('console.log("last")');
  expect(rendered).toContain("stdout:");
  expect(rendered).toContain("first\nlast");
});

test("task completion and attention collapse to recognizable summaries without output", () => {
  const content = "1 asynchronous task completed.\ntask_1 completed\nFinal output preview:\nSECRET_OUTPUT";
  const complete = completionPreview(content, false, theme, 0, "task-complete", {
    tasks: [{ id: "task_1", status: "completed", exitCode: 0 }],
  }).render(100);
  expect(complete.map((line) => line.trimEnd())).toEqual([
    "✓ Task complete · 1 asynchronous task completed. · task_1 completed exit 0",
  ]);
  expect(complete.join("\n")).not.toContain("SECRET_OUTPUT");
  const attention = completionPreview(
    "task_2 needs a progress checkpoint.\nSECRET_PROGRESS",
    false,
    theme,
    0,
    "task-attention",
    {
      attention: [{ id: "task_2" }],
    },
  ).render(100);
  expect(attention.map((line) => stripTerminalSequences(line).trimEnd())).toEqual([
    "⚠ Task attention · task_2 needs a progress checkpoint.",
  ]);
  expect(attention.join("\n")).not.toContain("SECRET_PROGRESS");
});

test("failed task and execute summaries retain failure status", () => {
  const failedTask = completionPreview("1 asynchronous task completed.\noutput", false, theme, 0, "task-complete", {
    tasks: [{ id: "task_bad", status: "failed", exitCode: 7 }],
  }).render(100);
  expect(failedTask[0]).toContain("✗ Task completion");
  expect(failedTask[0]).toContain("task_bad failed exit 7");
  const failure = executeOutputPreview(
    { content: [{ type: "text", text: "Execution failed with exit code 2.\n\nstderr:\nBAD" }] },
    false,
    true,
    theme,
    "throw new Error()",
  ).render(100);
  expect(failure).toHaveLength(1);
  expect(failure[0]).toContain("✗ Execution failed with exit code 2.");
});

test("collapsed rows are control-safe and bounded at small widths", () => {
  const hostile = "safe\x1b[2J\x1b]0;bad\x07\n" + "x".repeat(1_000);
  const result = { content: [{ type: "text", text: "Execution completed.\n" + hostile }] };
  const before = JSON.stringify(result);
  for (const width of [1, 5, 20, 80]) {
    for (const lines of [
      executeInputPreview(hostile, false, theme).render(width),
      executeOutputPreview(result, false, false, theme, hostile).render(width),
      completionPreview(hostile, false, theme).render(width),
    ]) {
      expect(lines).toHaveLength(1);
      expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
      expect(stripTerminalSequences(lines[0])).not.toContain("\x1b");
    }
  }
  expect(JSON.stringify(result)).toBe(before);
  expect(foldedRows("text", 0, 3, 3, false)).toEqual([]);
});

test("images remain summarized collapsed and represented by Pi content", () => {
  const rendered = executeOutputPreview(
    { content: [{ type: "image" }], details: { exitCode: 0, stdout: "", stderr: "", images: [{}] } },
    false,
    false,
    theme,
    "emitImage()",
  ).render(80);
  expect(rendered).toHaveLength(1);
  expect(rendered[0]).toContain("1 image");
});

test("full-batch diagnostics retain a failure omitted after the first 50 tasks", () => {
  const tasks = Array.from({ length: 51 }, (_, index) => ({
    id: "task_" + index,
    status: index === 50 ? "failed" : "completed",
    command: "true",
    output: "",
  })) as any;
  const details = completionDiagnosticDetails(tasks, []);
  expect(details.tasks).toHaveLength(50);
  expect(details.omittedTasks).toBe(1);
  expect(details.taskStatusCounts).toEqual({ completed: 50, failed: 1, killed: 0, running: 0, unknown: 0 });
  const row = completionPreview("51 asynchronous tasks completed.", false, theme, 0, "task-complete", details).render(
    32,
  )[0];
  expect(row.startsWith("✗ Task completion")).toBe(true);
  expect(visibleWidth(row)).toBeLessThanOrEqual(32);
});

test("legacy or incomplete completion metadata renders unknown rather than success", () => {
  for (const details of [undefined, {}, { tasks: [{ id: "old" }] }, { tasks: [], omittedTasks: 1 }]) {
    const row = completionPreview("Task update", false, theme, 0, "task-complete", details).render(80)[0];
    expect(row).toStartWith("? Task completion");
    expect(row).not.toStartWith("✓");
  }
});

test("mixed failure and attention indicators precede truncatable descriptions", () => {
  const row = completionPreview("A deliberately long completion description", false, theme, 0, "task-complete", {
    tasks: [{ id: "task_bad", status: "failed", signal: "SIGTERM" }],
    attention: [{ id: "task_waiting" }],
  }).render(18)[0];
  expect(row.startsWith("✗ ⚠ 1")).toBe(true);
  expect(visibleWidth(row)).toBeLessThanOrEqual(18);
});

test("untrusted task metadata is sanitized before terminal coloring", () => {
  const row = completionPreview("Done", false, theme, 0, "task-complete", {
    tasks: [{ id: "safe\x1b[2J", status: "failed\x1b]0;bad\x07", signal: "SIG\x1b[31mTERM" }],
  }).render(120)[0];
  expect(row).toContain("safe");
  expect(row).not.toContain("\x1b");
  expect(stripTerminalSequences(row)).not.toContain("\x07");
});

test("collapsed execute puts loss, image, and background diagnostics before long code", () => {
  const row = executeOutputPreview(
    {
      content: [{ type: "text", text: "Execution completed." }, { type: "image" }],
      details: { exitCode: 0, stdoutLost: true, stderrLost: true, images: [{}], backgroundJobs: ["a", "b"] },
    },
    false,
    false,
    theme,
    "LONG_COMMAND_SUFFIX".repeat(20),
  ).render(82)[0];
  expect(row).toContain("⚠ 2 streams lost");
  expect(row).toContain("1 image");
  expect(row).toContain("2 background");
  expect(row).not.toContain("LONG_COMMAND_SUFFIX");
});

test("execute error flag takes precedence over handoff success", () => {
  const row = executeOutputPreview(
    { content: [{ type: "text", text: "Execution failed." }], details: { handoff: "later" } },
    false,
    true,
    theme,
  ).render(80)[0];
  expect(row).toStartWith("✗ Execution failed.");
});
