import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Box,
  getKeybindings,
  stripTerminalSequences,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";

function plain(text: string): string {
  return stripTerminalSequences(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\p{Cc}/gu, (character) => (character === "\n" ? "\n" : ""));
}
function oneLine(text: string): string {
  return plain(text).replace(/\s+/g, " ").trim();
}
function expandHint(): string {
  const keys = getKeybindings().getKeys("app.tools.expand");
  return keys.length ? keys.join("/") + " to expand" : "expand for more";
}
export function foldedRows(text: string, width: number, head: number, tail: number, expanded: boolean): string[] {
  if (width < 1 || !text) return [];
  const rows = wrapTextWithAnsi(plain(text), width);
  if (expanded || rows.length <= head + tail) return rows;
  const hidden = rows.length - head - tail;
  return [
    ...rows.slice(0, head),
    truncateToWidth("… (" + hidden + " lines hidden; " + expandHint() + ")", width),
    ...(tail ? rows.slice(-tail) : []),
  ];
}
function component(render: (width: number) => string[]): Component {
  return { render, invalidate() {} };
}

export interface ExecutePreviewState {
  resultVisible?: boolean;
}
function commandSummary(code: unknown): string {
  return typeof code === "string" ? oneLine(code) : "";
}

export function executeInputPreview(
  code: unknown,
  expanded: boolean,
  theme: Theme,
  state?: ExecutePreviewState,
  executionStarted = true,
): Component {
  const source = typeof code === "string" ? code : "";
  return component((width) => {
    // Pi vertically composes call and result slots. Suppress the call slot once
    // the result renderer runs, leaving one settled physical row.
    if (state?.resultVisible || width < 1) return [];
    if (expanded)
      return [
        truncateToWidth(theme.fg("toolTitle", "Execute · TypeScript"), width),
        ...foldedRows(source, width, 0, 0, true).map((line) => theme.fg("muted", line)),
      ];
    const summary = commandSummary(source);
    const status = executionStarted ? "running" : "preparing";
    const line =
      theme.fg("warning", "…") +
      theme.fg("toolTitle", " Execute " + status) +
      (summary ? theme.fg("muted", " · " + summary) : "");
    return [truncateToWidth(line, width)];
  });
}

type TextResult = { content: Array<{ type: string; text?: string }>; details?: unknown };
type ExecuteDetails = {
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  cancelled?: boolean;
  imageError?: string;
  stdout?: unknown;
  stderr?: unknown;
  stdoutLost?: boolean;
  stderrLost?: boolean;
  images?: unknown[];
  handoff?: string;
  backgroundJobs?: string[];
};
function statusSummary(
  full: string,
  details: ExecuteDetails | undefined,
  isError: boolean,
): { icon: string; color: "success" | "error"; text: string } {
  const first = oneLine(full.split("\n")[0] ?? "");
  if (details?.handoff) return { icon: "✓", color: "success", text: "Execution handed off" };
  if (isError || details?.imageError || details?.timedOut || details?.cancelled)
    return { icon: "✗", color: "error", text: first || "Execution failed" };
  if (details?.exitCode !== undefined) {
    const ok = details.exitCode === 0;
    return {
      icon: ok ? "✓" : "✗",
      color: ok ? "success" : "error",
      text: "Execution " + (ok ? "completed" : "failed") + " · exit " + details.exitCode,
    };
  }
  return { icon: "✓", color: "success", text: first || "Execution completed" };
}

export function executeOutputPreview(
  result: TextResult,
  expanded: boolean,
  isError: boolean,
  theme: Theme,
  code?: unknown,
  state?: ExecutePreviewState,
): Component {
  if (state) state.resultVisible = true;
  const full = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  const details = result.details as ExecuteDetails | undefined;
  const status = statusSummary(full, details, isError);
  const source = typeof code === "string" ? code : "";
  return component((width) => {
    if (width < 1) return [];
    if (expanded) {
      const lines = [
        theme.fg("toolTitle", "Execute · TypeScript"),
        ...foldedRows(source, width, 0, 0, true).map((line) => theme.fg("muted", line)),
        "",
        ...foldedRows(full, width, 0, 0, true),
      ];
      if (details?.stdoutLost || details?.stderrLost)
        lines.push(theme.fg("warning", "… earlier output discarded by execute"));
      return lines.map((line) => truncateToWidth(line, width));
    }
    const imageCount = details?.images?.length ?? result.content.filter((part) => part.type === "image").length;
    const suffix = [commandSummary(code), imageCount ? imageCount + " image" + (imageCount === 1 ? "" : "s") : ""]
      .filter(Boolean)
      .join(" — ");
    const line =
      theme.fg(status.color, status.icon) +
      theme.fg("toolTitle", " " + status.text) +
      (suffix ? theme.fg("muted", " · " + suffix) : "");
    return [truncateToWidth(line, width)];
  });
}

interface CompletionDetails {
  tasks?: Array<{ id?: string; status?: string; exitCode?: number; signal?: string; timedOut?: boolean }>;
  attention?: Array<{ id?: string }>;
  omittedTasks?: number;
  omittedAttention?: number;
}
export function completionPreview(
  content: string | Array<{ type: string; text?: string }>,
  expanded: boolean,
  theme: Theme,
  padding = 0,
  kind: "task-complete" | "task-attention" = "task-complete",
  rawDetails?: unknown,
): Component {
  const details = rawDetails as CompletionDetails | undefined;
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n");
  const box = new Box(padding, 0);
  box.addChild(
    component((width) => {
      if (expanded)
        return foldedRows(text, width, 0, 0, true).map((line, index) =>
          index === 0 ? theme.fg(kind === "task-attention" ? "warning" : "accent", line) : line,
        );
      if (width < 1) return [];
      const tasks = details?.tasks ?? [];
      const failed = tasks.filter((task) => task.status && task.status !== "completed");
      const attention = (details?.attention?.length ?? 0) + (details?.omittedAttention ?? 0);
      const first = oneLine(text.split("\n")[0] ?? "");
      let label: string;
      let color: "success" | "error" | "warning";
      if (kind === "task-attention") {
        label = "⚠ Task attention · " + (first || "running task needs attention");
        color = "warning";
      } else if (failed.length) {
        label = "✗ Task completion · " + first;
        color = "error";
      } else {
        label = "✓ Task complete · " + first;
        color = "success";
      }
      if (tasks.length) {
        const statuses = tasks
          .slice(0, 3)
          .map((task) =>
            [task.id, task.status, task.exitCode !== undefined ? "exit " + task.exitCode : task.signal]
              .filter(Boolean)
              .join(" "),
          )
          .join(", ");
        if (statuses) label += " · " + statuses;
        const omitted = (details?.omittedTasks ?? 0) + Math.max(0, tasks.length - 3);
        if (omitted) label += " (+" + omitted + " more)";
      }
      if (attention && kind === "task-complete") label += " · ⚠ " + attention + " need attention";
      return [truncateToWidth(theme.fg(color, label), width)];
    }),
  );
  return box;
}
