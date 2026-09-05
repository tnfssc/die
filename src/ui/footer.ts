import { SessionCostTracker } from "../tasks/session-costs";
import { sessionCostRoot } from "../tasks/session-cost-root";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, sep } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CompactEditor } from "./editor";

function singleLine(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function tokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function footerPath(cwd: string, home = homedir()): string {
  const path = relative(home, cwd);
  return path === "" ? "~" : path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path) ? `~${sep}${path}` : cwd;
}

/** Keep active work visible even when the path must be shortened. */
export function pathWithTasks(path: string, taskStatus: string | undefined, width: number, theme: Theme): string {
  if (!taskStatus) return truncateToWidth(theme.fg("dim", singleLine(path)), width);
  const label = singleLine(taskStatus).replace(/^(\d+ tasks?) running$/, "$1");
  const badge = theme.fg("dim", " • ") + theme.fg("accent", label);
  const remaining = width - visibleWidth(badge);
  if (remaining < 1) return truncateToWidth(theme.fg("accent", label), width, "…");
  return truncateToWidth(theme.fg("dim", singleLine(path)), remaining, "…") + badge;
}

function columns(left: string, right: string, width: number): string {
  if (visibleWidth(left) + 2 + visibleWidth(right) <= width) {
    return left + " ".repeat(width - visibleWidth(left) - visibleWidth(right)) + right;
  }
  // Narrow terminals retain some model identity as well as usage.
  const rightBudget = Math.min(visibleWidth(right), Math.floor(width * 0.45));
  if (rightBudget < 1) return truncateToWidth(left, width, "…");
  const lhs = truncateToWidth(left, Math.max(0, width - rightBudget - 1), "…");
  const rhs = truncateToWidth(right, rightBudget, "…");
  return lhs + " ".repeat(Math.max(0, width - visibleWidth(lhs) - visibleWidth(rhs))) + rhs;
}

function footerUsage(ctx: ExtensionContext) {
  let input = 0, output = 0, read = 0, write = 0, cost = 0;
  let cacheHit: number | undefined;
  // Include pre-compaction usage, nested tool usage, and summaries, like Pi.
  for (const entry of ctx.sessionManager.getEntries()) {
    let usage: Usage | undefined;
    if (entry.type === "message" && entry.message.role === "assistant") {
      usage = entry.message.usage;
      const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
      cacheHit = prompt > 0 ? usage.cacheRead / prompt * 100 : undefined;
    } else if (entry.type === "message" && entry.message.role === "toolResult") {
      usage = entry.message.usage;
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      usage = entry.usage;
    } else if (entry.type === "custom" && entry.customType === "die-compaction-attempt") {
      usage = (entry.data as {usage?:Usage})?.usage;
    }
    if (usage) {
      input += usage.input; output += usage.output;
      read += usage.cacheRead; write += usage.cacheWrite;
      cost += usage.cost.total;
    }
  }
  return { input, output, read, write, cost, cacheHit };
}

export function renderDetailedFooter(ctx: ExtensionContext, data: ReadonlyFooterDataProvider, theme: Theme, width: number, descendantCost = 0): string[] {
  if (width < 1) return [];
  const { input, output, read, write, cost, cacheHit } = footerUsage(ctx);
  let path = footerPath(ctx.sessionManager.getCwd());
  const branch = data.getGitBranch();
  if (branch) path += ` (${branch})`;
  const name = ctx.sessionManager.getSessionName();
  if (name) path += ` • ${name}`;
  const stats: string[] = [];
  if (input) stats.push(`↑${tokens(input)}`);
  if (output) stats.push(`↓${tokens(output)}`);
  if (read) stats.push(`R${tokens(read)}`);
  if (write) stats.push(`W${tokens(write)}`);
  if ((read || write) && cacheHit !== undefined) stats.push(`CH${cacheHit.toFixed(1)}%`);
  const model = ctx.model;
  const subscription = model && (model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(model));
  if (cost || descendantCost || subscription) stats.push(`$${(cost + descendantCost).toFixed(3)}${descendantCost ? " total" : subscription ? " (sub)" : ""}`);
  const context = ctx.getContextUsage();
  const percent = context?.percent;
  const contextText = `${percent == null ? "?" : `${percent.toFixed(1)}%`}/${tokens(context?.contextWindow ?? model?.contextWindow ?? 0)}`;
  // The extension API exposes context usage, but not auto-compaction settings;
  // omit the native '(auto)' suffix rather than displaying an assumed setting.
  stats.push(theme.fg(percent != null && percent > 90 ? "error" : percent != null && percent > 70 ? "warning" : "dim", contextText));
  let modelText = model?.id ?? "no-model";
  if (model?.reasoning) modelText += ` • ${ctx.thinkingLevel ?? "off"}`;
  if (model && data.getAvailableProviderCount() > 1) {
    const withProvider = `(${model.provider}) ${modelText}`;
    if (visibleWidth(stats.join(" ")) + 2 + visibleWidth(withProvider) <= width) modelText = withProvider;
  }
  const statuses = data.getExtensionStatuses();
  const lines = [
    pathWithTasks(path, statuses.get("die-tasks"), width, theme),
    columns(theme.fg("dim", stats.join(" ")), theme.fg("dim", singleLine(modelText)), width),
  ];
  // Keep statuses owned by other extensions visible on their own row.
  const others = [...statuses].filter(([key]) => key !== "die-tasks").sort(([a], [b]) => a.localeCompare(b));
  if (others.length) lines.push(truncateToWidth(others.map(([, value]) => singleLine(value)).join(" "), width));
  return lines;
}

export function renderCompactFooter(ctx: ExtensionContext, data: ReadonlyFooterDataProvider, theme: Theme, width: number, descendantCost = 0): string[] {
  if (width < 1) return [];
  const project = singleLine(basename(ctx.sessionManager.getCwd()) || "/");
  const branch = data.getGitBranch();
  const task = singleLine(data.getExtensionStatuses().get("die-tasks") ?? "").replace(/^(\d+ tasks?) running$/, "$1");
  const shortTask = task.replace(/^(\d+) tasks?$/, "$1t");
  const otherCount = [...data.getExtensionStatuses().keys()].filter((key) => key !== "die-tasks").length;
  const extra = otherCount ? `+${otherCount} status` : "";
  const cost = `$${(footerUsage(ctx).cost + descendantCost).toFixed(3)}`;
  const percent = ctx.getContextUsage()?.percent;
  const percentText = percent == null ? "?" : `${percent.toFixed(1).replace(/\.0$/, "")}%`;
  const context = (label: string) => theme.fg(percent != null && percent > 90 ? "error" : percent != null && percent > 70 ? "warning" : "dim", label + percentText);
  const model = singleLine(ctx.model?.id ?? "no-model");
  const modelWithThinking = model + (ctx.model?.reasoning ? ` · ${ctx.thinkingLevel ?? "off"}` : "");
  const accent = (text: string) => text ? theme.fg("accent", text) : "";
  const candidates: [string[], string, string][] = [
    [[branch ? `${project}:${singleLine(branch)}` : project, accent(task), cost, context("ctx "), extra], modelWithThinking, " · "],
    [[project, accent(task), cost, context("ctx "), extra], modelWithThinking, " · "],
    [[accent(shortTask), cost, context("C"), project, extra], model, " "],
    [[accent(shortTask), cost, context("C"), extra], model, " "],
  ];
  for (const [parts, right, separator] of candidates) {
    const left = parts.filter(Boolean).join(separator);
    if (visibleWidth(left) + 2 + visibleWidth(right) <= width) {
      return [columns(theme.fg("dim", left), theme.fg("dim", right), width)];
    }
  }
  const [parts, right, separator] = candidates[candidates.length - 1]!;
  return [columns(theme.fg("dim", parts.filter(Boolean).join(separator)), theme.fg("dim", right), width)];
}

export function createCompactUI(pi: ExtensionAPI): (ctx: ExtensionContext) => void {
  let expanded = false;
  let tracker: SessionCostTracker | undefined;
  let disposeFooter: (() => void) | undefined;
  const install = (ctx: ExtensionContext) => {
    const root = sessionCostRoot(ctx.sessionManager);
    if (!root) tracker = undefined;
    else if (tracker?.rootFile !== root.file) tracker = new SessionCostTracker(root.file, root.directory);
    disposeFooter?.();
    disposeFooter = installCompactFooter(ctx, () => expanded, tracker);
  };
  pi.on("session_shutdown", () => {
    disposeFooter?.();
    disposeFooter = undefined;
    tracker = undefined;
  });
  pi.registerCommand("status", {
    description: "Toggle full path, token/cache usage, provider and extension statuses",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      expanded = !expanded;
      install(ctx);
    },
  });
  return (ctx) => {
    if (ctx.mode !== "tui") return;
    // Respect an editor already installed by another extension.
    if (!ctx.ui.getEditorComponent()) {
      ctx.ui.setEditorComponent((tui, theme, bindings) =>
        new CompactEditor(tui, theme, bindings, { paddingX: 0, embedWorkingStatus: true }));
    }
    installCompactFooter(ctx, () => expanded);
  };
}

export function installCompactFooter(
  ctx: ExtensionContext,
  expanded: () => boolean = () => false,
  tracker?: SessionCostTracker,
): () => void {
  if (ctx.mode !== "tui") return () => {};
  if (!tracker) {
    const root = sessionCostRoot(ctx.sessionManager);
    if (root) tracker = new SessionCostTracker(root.file, root.directory);
  }
  let dispose = () => {};
  let stopped = false;
  ctx.ui.setFooter((tui, theme, data) => {
    const unsubscribe = data.onBranchChange(() => tui.requestRender());
    let active = !stopped;
    let busy = false;
    const refresh = async () => {
      if (!active || busy || !tracker) return;
      busy = true;
      const before = tracker.descendantCost;
      try {
        await tracker.refresh();
        if (active && tracker.descendantCost !== before) tui.requestRender();
      } catch {
        // A transient filesystem error must not interrupt the terminal.
      } finally { busy = false; }
    };
    const timer = active && tracker ? setInterval(() => { void refresh(); }, 1000) : undefined;
    timer?.unref?.();
    void refresh();
    let disposed = false;
    dispose = () => {
      if (disposed) return;
      disposed = true;
      active = false;
      if (timer) clearInterval(timer);
      unsubscribe();
    };
    return {
      render: (width) => (expanded() ? renderDetailedFooter : renderCompactFooter)(ctx, data, theme, width, tracker?.descendantCost ?? 0),
      invalidate() { theme = ctx.ui.theme; },
      dispose,
    };
  });
  return () => { stopped = true; dispose(); };
}
