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
  const summary = commandSummary(source);
  return component((width) => {
    // Pi vertically composes call and result slots. Suppress the call slot once
    // the result renderer runs, leaving one settled physical row.
    if (state?.resultVisible || width < 1) return [];
    if (expanded)
      return [
        truncateToWidth(theme.fg("toolTitle", "Execute · TypeScript"), width),
        ...foldedRows(source, width, 0, 0, true).map((line) => theme.fg("muted", line)),
      ];
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
  if (isError || details?.imageError || details?.timedOut || details?.cancelled)
    return { icon: "✗", color: "error", text: first || "Execution failed" };
  if (details?.handoff) return { icon: "✓", color: "success", text: "Execution handed off" };
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
  const summary = commandSummary(code);
  const imageCount = Array.isArray(details?.images)
    ? details.images.length
    : result.content.filter((part) => part.type === "image").length;
  const lostStreams = Number(details?.stdoutLost === true) + Number(details?.stderrLost === true);
  const backgroundCount = Array.isArray(details?.backgroundJobs) ? details.backgroundJobs.length : 0;
  const diagnostic = [
    lostStreams ? "⚠ " + lostStreams + " stream" + (lostStreams === 1 ? "" : "s") + " lost" : "",
    imageCount ? imageCount + " image" + (imageCount === 1 ? "" : "s") : "",
    backgroundCount ? backgroundCount + " background" : "",
  ]
    .filter(Boolean)
    .join(" — ");
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
    const suffix = [diagnostic, summary].filter(Boolean).join(" — ");
    const line =
      theme.fg(status.color, status.icon) +
      theme.fg("toolTitle", " " + status.text) +
      (suffix ? theme.fg("muted", " · " + suffix) : "");
    return [truncateToWidth(line, width)];
  });
}

interface CompletionDetails {
  tasks?: Array<{ id?: unknown; status?: unknown; exitCode?: unknown; signal?: unknown; timedOut?: unknown }>;
  attention?: Array<{ id?: unknown }>;
  taskStatusCounts?: Partial<Record<"completed" | "failed" | "killed" | "running" | "unknown", unknown>>;
  taskCount?: unknown;
  attentionCount?: unknown;
  omittedTasks?: unknown;
  omittedAttention?: unknown;
}
function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function safeMetadata(value: unknown): string {
  return typeof value === "string" ? oneLine(value) : "";
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
      const tasks = Array.isArray(details?.tasks) ? details.tasks : [];
      const omittedTasks = count(details?.omittedTasks);
      const statuses = tasks.map((task) => safeMetadata(task?.status));
      const aggregate = details?.taskStatusCounts;
      const hasAggregate =
        !!aggregate &&
        ["completed", "failed", "killed", "running", "unknown"].every(
          (status) => typeof aggregate[status as keyof typeof aggregate] === "number",
        );
      const failedCount = hasAggregate
        ? count(aggregate?.failed) + count(aggregate?.killed)
        : statuses.filter((status) => status && status !== "completed").length;
      const aggregateUnknown = hasAggregate
        ? count(aggregate?.unknown) + count(aggregate?.running) > 0 ||
          Object.values(aggregate ?? {}).reduce<number>((sum, value) => sum + count(value), 0) !==
            count(details?.taskCount)
        : false;
      const unknown = hasAggregate
        ? aggregateUnknown
        : tasks.length === 0 || omittedTasks > 0 || statuses.some((status) => !status);
      const attention =
        typeof details?.attentionCount === "number"
          ? count(details.attentionCount)
          : (Array.isArray(details?.attention) ? details.attention.length : 0) + count(details?.omittedAttention);
      const first = oneLine(text.split("\n")[0] ?? "");
      let label: string;
      let color: "success" | "error" | "warning";
      if (kind === "task-attention") {
        label = "⚠ Task attention · " + (first || "running task needs attention");
        color = "warning";
      } else {
        const attentionPrefix = attention ? "⚠ " + attention + " need attention · " : "";
        if (failedCount) {
          label = "✗ " + attentionPrefix + "Task completion · " + first;
          color = "error";
        } else if (unknown) {
          label = attentionPrefix + "? Task completion · " + first;
          color = "warning";
        } else {
          label = attentionPrefix + "✓ Task complete · " + first;
          color = attention ? "warning" : "success";
        }
      }
      if (tasks.length) {
        const descriptions = tasks
          .slice(0, 3)
          .map((task) => {
            const exitCode =
              typeof task.exitCode === "number" && Number.isFinite(task.exitCode) ? task.exitCode : undefined;
            return [
              safeMetadata(task.id),
              safeMetadata(task.status),
              exitCode !== undefined ? "exit " + exitCode : safeMetadata(task.signal),
            ]
              .filter(Boolean)
              .join(" ");
          })
          .filter(Boolean)
          .join(", ");
        if (descriptions) label += " · " + descriptions;
        const omitted = omittedTasks + Math.max(0, tasks.length - 3);
        if (omitted) label += " (+" + omitted + " more)";
      }
      return [truncateToWidth(theme.fg(color, label), width)];
    }),
  );
  return box;
}
