import { expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
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

test("expanded execute includes the full command and output", () => {
  const rendered = executeOutputPreview(success, true, false, theme, code).render(100).join("\n");
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
