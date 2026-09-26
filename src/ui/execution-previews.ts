import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  getKeybindings,
  stripTerminalSequences,
  truncateToWidth,
  wrapTextWithAnsi,
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
function padded(component: Component, padding: number): Component {
  if (padding <= 0) return component;
  const box = new Box(padding, 0);
  box.addChild(component);
  return box;
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
  _executionStarted = true,
  padding = 0,
): Component {
  const source = typeof code === "string" ? code : "";
  const summary = commandSummary(source);
  return padded(
    component((width) => {
      // Pi vertically composes call and result slots. Suppress the call slot once
      // the result renderer runs, leaving one settled physical row.
      if (state?.resultVisible || width < 1) return [];
      if (expanded)
        return [
          truncateToWidth(theme.fg("toolTitle", "Execute · TypeScript"), width),
          ...foldedRows(source, width, 0, 0, true).map((line) => theme.fg("muted", line)),
        ];
      const line =
        theme.fg("warning", "…") +
        theme.fg("toolTitle", " executing") +
        (summary ? theme.fg("muted", " · " + summary) : "");
      return [truncateToWidth(line, width)];
    }),
    padding,
  );
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
  stdoutPath?: string;
  stderrPath?: string;
  outputArtifactErrors?: unknown;
  images?: unknown[];
  handoff?: string;
  backgroundJobs?: string[];
};
function statusSummary(
  full: string,
  details: ExecuteDetails | undefined,
  isError: boolean,
): { icon: string; color: "success" | "error" | "warning"; text: string } {
  const first = oneLine(full.split("\n")[0] ?? "");
  // Structured result details, rather than prose intended for the model, are
  // authoritative. This keeps cancelled and non-zero executions from ever
  // acquiring a success treatment when their wording changes.
  if (isError || details?.imageError || details?.timedOut || details?.cancelled)
    return { icon: "✗", color: "error", text: "execute failed" };
  if (details?.handoff) return { icon: "✓", color: "success", text: "executed" };
  if (typeof details?.exitCode === "number") {
    const ok = details.exitCode === 0;
    return { icon: ok ? "✓" : "✗", color: ok ? "success" : "error", text: ok ? "executed" : "execute failed" };
  }
  return { icon: "?", color: "warning", text: first || "execute result" };
}

export function executeOutputPreview(
  result: TextResult,
  expanded: boolean,
  isError: boolean,
  theme: Theme,
  code?: unknown,
  state?: ExecutePreviewState,
  padding = 0,
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
  const truncated = details?.stdoutLost === true || details?.stderrLost === true;
  const backgroundCount =
    !details?.handoff && Array.isArray(details?.backgroundJobs) ? details.backgroundJobs.length : 0;
  const diagnostic = [
    truncated ? "truncated" : "",
    details?.outputArtifactErrors ? "⚠ output save error" : "",
    imageCount ? imageCount + " image" + (imageCount === 1 ? "" : "s") : "",
    backgroundCount ? backgroundCount + " background" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const handoff = typeof details?.handoff === "string" ? details.handoff.trim() : "";
  return padded(
    component((width) => {
      if (width < 1) return [];
      if (!expanded && handoff && status.color === "success") {
        const prefix = "↪ ";
        return foldedRows(handoff, Math.max(1, width - prefix.length), 0, 0, true).map((line, index) =>
          truncateToWidth((index === 0 ? theme.fg("success", prefix) : " ".repeat(prefix.length)) + line, width),
        );
      }
      if (expanded) {
        const lines = [
          theme.fg("toolTitle", "Execute · TypeScript"),
          ...foldedRows(source, width, 0, 0, true).map((line) => theme.fg("muted", line)),
          "",
          ...foldedRows(full, width, 0, 0, true),
        ];
        if (details?.outputArtifactErrors) lines.push(theme.fg("warning", "… execute could not save all output"));
        return lines.map((line) => truncateToWidth(line, width));
      }
      const suffix = [diagnostic, summary].filter(Boolean).join(" · ");
      const line =
        theme.fg(status.color, status.icon) +
        theme.fg("toolTitle", " " + status.text) +
        (suffix ? theme.fg("muted", " · " + suffix) : "");
      return [truncateToWidth(line, width)];
    }),
    padding,
  );
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
          index === 0 && kind !== "task-attention" ? theme.fg("accent", line) : line,
        );
      if (width < 1) return [];
      const tasks = Array.isArray(details?.tasks) ? details.tasks : [];
      const omittedTasks = count(details?.omittedTasks);
      const attention = Array.isArray(details?.attention) ? details.attention : [];
      const omittedAttention = count(details?.omittedAttention);
      const first = oneLine(text.split("\n")[0] ?? "");

      if (kind === "task-attention") {
        const label = "⚠ Task attention · " + (first || "running task needs attention");
        return [truncateToWidth(label, width)];
      }

      const aggregate = details?.taskStatusCounts;
      const hasAggregate =
        !!aggregate &&
        ["completed", "failed", "killed", "running", "unknown"].every(
          (status) => typeof aggregate[status as keyof typeof aggregate] === "number",
        );
      const knownCounts = { completed: 0, failed: 0, killed: 0, running: 0, unknown: 0 };
      for (const task of tasks) {
        const status = safeMetadata(task?.status);
        if (status in knownCounts) knownCounts[status as keyof typeof knownCounts]++;
        else knownCounts.unknown++;
      }

      const pieces: string[] = [];
      const add = (color: "success" | "error" | "warning" | "normal", value: string) => {
        if (value) pieces.push(color === "normal" ? value : theme.fg(color, value));
      };

      // Metadata can be capped for large batches. Surface an omitted failure
      // before the ID sequence so narrow terminals cannot make the batch look
      // successful merely because the failed task was outside the cap.
      if (hasAggregate) {
        const omittedFailures =
          count(aggregate?.failed) + count(aggregate?.killed) - knownCounts.failed - knownCounts.killed;
        if (omittedFailures > 0)
          add("error", "✗ " + omittedFailures + " omitted task" + (omittedFailures === 1 ? "" : "s") + " failed");
        const omittedUncertain =
          count(aggregate?.running) + count(aggregate?.unknown) - knownCounts.running - knownCounts.unknown;
        if (omittedUncertain > 0)
          add(
            "warning",
            "? " + omittedUncertain + " omitted task" + (omittedUncertain === 1 ? "" : "s") + " unresolved",
          );
      }

      for (const task of tasks) {
        const id = safeMetadata(task?.id) || "task";
        const status = safeMetadata(task?.status);
        if (status === "completed") add("success", "✓ " + id + " executed");
        else if (status === "failed" || status === "killed") add("error", "✗ " + id + " failed");
        else add("warning", "? " + id + (status ? " " + status : " status unknown"));
      }

      for (const notice of attention) {
        const id = safeMetadata(notice?.id);
        add("normal", "⚠ " + (id ? id + " needs attention" : "task needs attention"));
      }
      if (omittedAttention) add("normal", "⚠ " + omittedAttention + " more need attention");

      if (omittedTasks && !hasAggregate) add("warning", "? " + omittedTasks + " task details omitted");
      if (!pieces.length) add("warning", "? Task completion · " + (first || "unknown task update"));
      return [truncateToWidth(pieces.join(", "), width)];
    }),
  );
  return box;
}
