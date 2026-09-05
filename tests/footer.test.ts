import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { createCompactUI, footerPath, installCompactFooter, pathWithTasks, renderCompactFooter as renderSingleRowFooter, renderDetailedFooter } from "../src/ui/footer";

const theme = { fg: (color: string, text: string) => `\x1b[${color === "accent" ? 36 : 90}m${text}\x1b[0m` } as Theme;
const plain = (lines: string[]) => lines.map((line) => Bun.stripANSI(line));
function fixture() {
  const statuses = new Map<string, string>([["die-tasks", "30 tasks running"]]);
  const usage = { input: 6900, output: 813, cacheRead: 0, cacheWrite: 0, cost: { total: 0.002 } };
  const ctx = {
    mode: "tui",
    sessionManager: {
      getEntries: () => [{ type: "message", message: { role: "assistant", usage } }],
      getCwd: () => join(homedir(), "Code/die"),
      getSessionName: () => undefined,
    },
    model: { id: "gpt-5.6-luna", provider: "openai-codex", reasoning: true, contextWindow: 272000 },
    thinkingLevel: "medium",
    modelRegistry: { isUsingOAuth: () => true },
    getContextUsage: () => ({ percent: 1, contextWindow: 272000, tokens: 2720 }),
    ui: { theme },
  } as unknown as ExtensionContext;
  const data = {
    getGitBranch: () => "develop",
    getAvailableProviderCount: () => 2,
    getExtensionStatuses: () => statuses,
    onBranchChange: () => () => {},
  } as ReadonlyFooterDataProvider;
  return { ctx, data, statuses };
}

describe("compact extension footer", () => {
  test("/status toggles details without replacing the editor or changing the draft", async () => {
    const { ctx, data } = fixture();
    let command!: Parameters<ExtensionAPI["registerCommand"]>[1];
    const install = createCompactUI({ on() {}, registerCommand: (name: string, value: Parameters<ExtensionAPI["registerCommand"]>[1]) => { expect(name).toBe("status"); command = value; } } as unknown as ExtensionAPI);
    let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
    let editors = 0;
    ctx.ui.setFooter = (value) => { factory = value; };
    ctx.ui.getEditorComponent = () => undefined;
    ctx.ui.setEditorComponent = () => { editors++; };
    install(ctx);
    const render = () => {
      const component = factory!({ requestRender() {} } as Parameters<NonNullable<typeof factory>>[0], theme, data);
      const result = component.render(120);
      component.dispose?.();
      return result;
    };
    expect(render()).toHaveLength(1);
    await command.handler("", ctx as ExtensionCommandContext);
    expect(render()).toHaveLength(2);
    await command.handler("", ctx as ExtensionCommandContext);
    expect(render()).toHaveLength(1);
    expect(editors).toBe(1);
  });

  test("default is one row including tasks, cost, context, model and thinking", () => {
    const { ctx, data, statuses } = fixture();
    const lines = plain(renderSingleRowFooter(ctx, data, theme, 120));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("die:develop · 30 tasks · $0.002 · ctx 1%");
    expect(lines[0]).toEndWith("gpt-5.6-luna · medium");
    statuses.set("review", "review in progress");
    expect(plain(renderSingleRowFooter(ctx, data, theme, 120))[0]).toContain("+1 status");
    for (const width of [1, 4, 10, 20, 40, 44, 80, 120]) {
      const rendered = renderSingleRowFooter(ctx, data, theme, width);
      expect(rendered).toHaveLength(1);
      expect(visibleWidth(rendered[0]!)).toBeLessThanOrEqual(width);
    }
    const narrow = plain(renderSingleRowFooter(ctx, data, theme, 44))[0]!;
    for (const value of ["30t", "$0.002", "C1%", "gpt-5.6-luna"]) expect(narrow).toContain(value);
    statuses.delete("die-tasks");
    expect(plain(renderSingleRowFooter(ctx, data, theme, 120))[0]).not.toContain("tasks");
  });

  test("puts task count beside the directory without losing usage or model information", () => {
    const { ctx, data } = fixture();
    const lines = plain(renderDetailedFooter(ctx, data, theme, 150));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("~/Code/die (develop) • 30 tasks");
    expect(lines[1]).toContain("↑6.9k ↓813 $0.002 (sub) 1.0%/272k");
    expect(lines[1]).toEndWith("(openai-codex) gpt-5.6-luna • medium");
  });

  test("clears completed counts and preserves other extensions' statuses", () => {
    const { ctx, data, statuses } = fixture();
    statuses.set("die-tasks", "1 task running");
    expect(plain(renderDetailedFooter(ctx, data, theme, 100))[0]).toEndWith(" • 1 task");
    statuses.delete("die-tasks");
    expect(plain(renderDetailedFooter(ctx, data, theme, 100))[0]).toBe("~/Code/die (develop)");
    statuses.set("review", "review\nin progress");
    expect(plain(renderDetailedFooter(ctx, data, theme, 100))[2]).toBe("review in progress");
  });

  test("respects narrow widths, Unicode paths, ANSI styles, and live counts", () => {
    const { ctx, data, statuses } = fixture();
    ctx.sessionManager.getCwd = () => join(homedir(), "项目/very-long-path/another-long-directory");
    for (const width of [1, 4, 10, 20, 40, 80, 120]) {
      const lines = renderDetailedFooter(ctx, data, theme, width);
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      if (width >= 10) expect(Bun.stripANSI(lines[0])).toContain("30 tasks");
    }
    statuses.set("die-tasks", "50 tasks running");
    expect(plain(renderDetailedFooter(ctx, data, theme, 40))[0]).toContain("50 tasks");
    expect(renderDetailedFooter(ctx, data, theme, 0)).toEqual([]);
  });

  test("includes tool/summary usage and unknown post-compaction context", () => {
    const { ctx, data } = fixture();
    const usage = { input: 100, output: 10, cacheRead: 200, cacheWrite: 0, cost: { total: 0.001 } };
    ctx.sessionManager.getEntries = () => [
      { type: "message", message: { role: "assistant", usage } },
      { type: "message", message: { role: "toolResult", usage } },
      { type: "compaction", usage },
      { type: "branch_summary", usage },
    ] as ReturnType<ExtensionContext["sessionManager"]["getEntries"]>;
    ctx.getContextUsage = () => ({ tokens: null, percent: null, contextWindow: 272000 });
    expect(plain(renderDetailedFooter(ctx, data, theme, 150))[1]).toContain("↑400 ↓40 R800 CH66.7% $0.004 (sub) ?/272k");
  });

  test("does not abbreviate directories outside the home or leak path newlines", () => {
    expect(footerPath("/home/alice-two/project", "/home/alice")).toBe("/home/alice-two/project");
    expect(footerPath("/home/alice", "/home/alice")).toBe("~");
    expect(Bun.stripANSI(pathWithTasks("path\nname", "30 tasks running", 80, theme))).toBe("path name • 30 tasks");
  });

  test("uses setFooter only in TUI mode and disposes its reactive subscription", () => {
    const { ctx, data } = fixture();
    let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
    ctx.ui.setFooter = (value) => { factory = value; };
    ctx.mode = "rpc";
    installCompactFooter(ctx);
    expect(factory).toBeUndefined();
    ctx.mode = "tui";
    installCompactFooter(ctx, () => true);
    expect(factory).toBeFunction();
    let renderRequested = false, disposed = false;
    let onBranchChange!: () => void;
    data.onBranchChange = (callback) => { onBranchChange = callback; return () => { disposed = true; }; };
    const component = factory!({ requestRender: () => { renderRequested = true; } } as Parameters<NonNullable<typeof factory>>[0], theme, data);
    onBranchChange();
    expect(renderRequested).toBe(true);
    const alternate = { fg: (_color: string, text: string) => text } as Theme;
    Object.defineProperty(ctx.ui, "theme", { value: alternate });
    component.invalidate();
    expect(component.render(150)[0]).toBe("~/Code/die (develop) • 30 tasks");
    component.dispose?.();
    expect(disposed).toBe(true);
  });
});

test("both footer modes combine costs without adding child tokens or context", () => {
  const { ctx, data } = fixture();
  expect(plain(renderSingleRowFooter(ctx, data, theme, 120, 0.125))[0]).toContain("$0.127");
  const detailed = plain(renderDetailedFooter(ctx, data, theme, 150, 0.125))[1]!;
  expect(detailed).toContain("↑6.9k ↓813 $0.127 total 1.0%/272k");
  expect(detailed).not.toContain("(sub)");
});

test("disposing the footer suppresses an in-flight cost refresh redraw", async () => {
  const { ctx, data } = fixture();
  let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
  ctx.ui.setFooter = value => { factory = value; };
  let finish!: () => void;
  const tracker = { descendantCost: 0, refresh: () => new Promise<number>(resolve => {
    finish = () => { tracker.descendantCost = 1; resolve(1); };
  }) };
  const dispose = installCompactFooter(ctx, () => false, tracker as unknown as import("../src/tasks/session-costs").SessionCostTracker);
  let renders = 0, unsubscribed = 0;
  data.onBranchChange = () => () => { unsubscribed++; };
  const component = factory!({ requestRender() { renders++; } } as Parameters<NonNullable<typeof factory>>[0], theme, data);
  dispose();
  component.dispose?.();
  finish();
  await Promise.resolve();
  expect(renders).toBe(0);
  expect(unsubscribed).toBe(1);
});

test("footer includes failed compaction attempt costs without changing context usage", () => {
  const {ctx,data}=fixture();
  const entries=ctx.sessionManager.getEntries();
  ctx.sessionManager.getEntries=()=>[...entries,{type:"custom",customType:"die-compaction-attempt",data:{usage:{input:100,output:10,cacheRead:200,cacheWrite:0,cost:{total:0.004}}}}] as ReturnType<ExtensionContext["sessionManager"]["getEntries"]>;
  expect(plain(renderSingleRowFooter(ctx,data,theme,150))[0]).toContain("$0.006");
  expect(plain(renderSingleRowFooter(ctx,data,theme,150))[0]).toContain("ctx 1%");
});
