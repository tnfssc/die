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
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}
function expandHint(): string {
  const keys = getKeybindings().getKeys("app.tools.expand");
  return keys.length ? keys.join("/") + " to expand" : "expand for more";
}
/** Fold by rendered rows, so one long JSON line cannot flood a narrow terminal. */
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
export function executeInputPreview(code: unknown, expanded: boolean, theme: Theme): Component {
  const source = typeof code === "string" ? code : "";
  return component((width) =>
    width < 1
      ? []
      : [
          truncateToWidth(theme.fg("toolTitle", "Execute · TypeScript"), width),
          ...foldedRows(source, width, 3, 0, expanded).map((line) => theme.fg("muted", line)),
        ],
  );
}
type TextResult = { content: Array<{ type: string; text?: string }>; details?: unknown };
export function executeOutputPreview(result: TextResult, expanded: boolean, isError: boolean, theme: Theme): Component {
  const full = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  const details = result.details as
    | {
        stdout?: unknown;
        stderr?: unknown;
        stdoutLost?: boolean;
        stderrLost?: boolean;
        images?: unknown[];
        handoff?: string;
      }
    | undefined;
  const status = plain(full.split("\n")[0] || (isError ? "Execution failed" : "Execution result"));
  let output = full.includes("\n") ? full.slice(full.indexOf("\n") + 1).trim() : "";
  if (details && (typeof details.stdout === "string" || typeof details.stderr === "string")) {
    output = [
      typeof details.stdout === "string" && details.stdout ? "stdout:\n" + details.stdout : "",
      typeof details.stderr === "string" && details.stderr ? "stderr:\n" + details.stderr : "",
    ]
      .filter(Boolean)
      .join("\n")
      .trimEnd();
  }
  if (details?.handoff) output = details.handoff + (output ? "\n" + output : "");
  return component((width) => {
    if (width < 1) return [];
    if (expanded) return foldedRows(full, width, 0, 0, true);
    return [
      truncateToWidth(theme.fg(isError ? "error" : "dim", status), width),
      ...(details?.stdoutLost || details?.stderrLost
        ? [truncateToWidth(theme.fg("warning", "… earlier output discarded by execute"), width)]
        : []),
      ...foldedRows(output, width, details?.handoff ? 2 : 0, details?.handoff ? 3 : 5, false),
      ...(details?.images?.length ? [truncateToWidth("Images: " + details.images.length, width)] : []),
    ];
  });
}
export function completionPreview(
  content: string | Array<{ type: string; text?: string }>,
  expanded: boolean,
  theme: Theme,
  padding = 0,
): Component {
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n");
  const box = new Box(padding, 0);
  box.addChild(
    component((width) =>
      foldedRows(text, width, 3, 3, expanded).map((line, index) => (index === 0 ? theme.fg("accent", line) : line)),
    ),
  );
  return box;
}
