import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { inspectDiagnostics } from "../src/diagnostics";
import { mainAgentGuidance, replaceMainAgentGuidance } from "../src/prompts";
import { INSTRUCTION_MODE_ENTRY, registerInstructionMode } from "../src/tasks/instruction-mode";

function fixture(root = true, entries: any[] = [], appendError?: Error) {
  let command: any;
  const appended: any[] = [],
    notices: any[] = [],
    statuses: any[] = [];
  const pi = {
    registerCommand(name: string, value: any) {
      if (name === "mode") command = value;
    },
    appendEntry(type: string, data: unknown) {
      if (appendError) throw appendError;
      appended.push({ type, data });
    },
  } as any;
  const manager = { getEntries: () => entries, getBranch: () => entries, getSessionId: () => "session" };
  const ctx = {
    sessionManager: manager,
    ui: {
      notify: (message: string, kind: string) => notices.push({ message, kind }),
      setStatus: (key: string, value: string | undefined) => statuses.push({ key, value }),
    },
  } as any;
  const mode = registerInstructionMode(pi, () => root);
  mode.sessionStart(ctx);
  return { mode, command, appended, notices, statuses, ctx };
}

test("/mode reports, validates, persists and changes instructions only", async () => {
  const f = fixture();
  expect(f.mode.get()).toBe("orchestrator");
  await f.command.handler("", f.ctx);
  expect(f.notices.at(-1).message).toContain("Use /mode fast|normal|orchestrator");
  await f.command.handler("turbo", f.ctx);
  expect(f.notices.at(-1)).toMatchObject({ kind: "error", message: "Usage: /mode fast|normal|orchestrator" });
  await f.command.handler("fast", f.ctx);
  expect(f.mode.get()).toBe("fast");
  expect(f.appended).toEqual([{ type: "die-instruction-mode", data: { mode: "fast" } }]);
  expect(f.statuses.at(-1)).toEqual({ key: "die-mode", value: "mode: fast" });
  expect(f.notices.at(-1).message).toContain("model and thinking unchanged");
  await f.command.handler("fast", f.ctx);
  expect(f.appended).toHaveLength(1);
});

test("resume uses the latest valid session mode and child mode is isolated", async () => {
  const resumed = fixture(true, [
    { type: "custom", customType: "die-instruction-mode", data: { mode: "normal" } },
    { type: "custom", customType: "die-instruction-mode", data: { mode: "invalid" } },
    { type: "custom", customType: "die-instruction-mode", data: { mode: "fast" } },
  ]);
  expect(resumed.mode.get()).toBe("fast");
  const child = fixture(false, [{ type: "custom", customType: "die-instruction-mode", data: { mode: "fast" } }]);
  await child.command.handler("normal", child.ctx);
  expect(child.mode.get()).toBe("orchestrator");
  expect(child.appended).toEqual([]);
  expect(child.notices.at(-1).message).toContain("fixed role and delegation depth");
});

test("latest corrupt mode is an authority boundary and falls back safely", () => {
  const resumed = fixture(true, [
    { type: "custom", customType: INSTRUCTION_MODE_ENTRY, data: { mode: "fast" } },
    { type: "custom", customType: INSTRUCTION_MODE_ENTRY, data: { mode: "invalid" } },
  ]);
  expect(resumed.mode.get()).toBe("orchestrator");
  expect(inspectDiagnostics(resumed.ctx.sessionManager).records).toContainEqual({
    version: 1,
    generated: expect.any(String),
    component: "settings",
    code: "settings_invalid",
    outcome: "fallback",
  });
});

test("bounded mode replacement preserves framing before and after it", () => {
  const owner = "owned-test-region";
  const frame = "CUSTOM BEFORE\n" + mainAgentGuidance("orchestrator", owner) + "\nCUSTOM AFTER";
  const switched = replaceMainAgentGuidance(frame, "normal", owner);
  expect(switched).toStartWith("CUSTOM BEFORE");
  expect(switched).toEndWith("CUSTOM AFTER");
  expect(switched).toContain("main agent in normal instruction mode");
  expect(switched).not.toContain("main agent in orchestrator instruction mode");
  expect(replaceMainAgentGuidance("EXPLICIT CUSTOM", "fast", owner)).toBe("EXPLICIT CUSTOM");
});

test("resume reads only the active branch", () => {
  const abandoned = { type: "custom", customType: "die-instruction-mode", data: { mode: "fast" } };
  const active = { type: "custom", customType: "die-instruction-mode", data: { mode: "normal" } };
  const f = fixture(true, [active]);
  f.ctx.sessionManager.getEntries = () => [active, abandoned];
  f.mode.refresh(f.ctx);
  expect(f.mode.get()).toBe("normal");
});

test("failed mode persistence leaves memory, status, and frame unchanged", async () => {
  const f = fixture(true, [], new Error("disk full"));
  await f.command.handler("fast", f.ctx);
  expect(f.mode.get()).toBe("orchestrator");
  expect(f.statuses.at(-1)).toEqual({ key: "die-mode", value: "mode: orchestrator" });
  expect(f.notices.at(-1)).toMatchObject({ kind: "error" });
  expect(f.notices.at(-1).message).toContain("disk full");
});

test("a real SessionManager branch ignores mode entries on the abandoned branch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-mode-branch-"));
  try {
    const manager = SessionManager.create(dir, dir);
    const activeMode = manager.appendCustomEntry(INSTRUCTION_MODE_ENTRY, { mode: "normal" });
    manager.appendCustomEntry(INSTRUCTION_MODE_ENTRY, { mode: "fast" });
    manager.branch(activeMode);
    manager.appendCustomEntry("active-tip", {});
    let command: any;
    const pi = {
      registerCommand(name: string, value: any) {
        if (name === "mode") command = value;
      },
      appendEntry() {},
    } as any;
    const state = registerInstructionMode(pi, () => true);
    const ctx = { sessionManager: manager, ui: { setStatus() {}, notify() {} } } as any;
    state.sessionStart(ctx);
    expect(state.get()).toBe("normal");
    expect(
      manager
        .getEntries()
        .some(
          (entry) =>
            entry.type === "custom" &&
            entry.customType === INSTRUCTION_MODE_ENTRY &&
            (entry.data as any).mode === "fast",
        ),
    ).toBe(true);
    expect(command).toBeDefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a real disk reopen produces a byte-identical mode prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-mode-reopen-"));
  try {
    const created = SessionManager.create(dir, dir);
    await Bun.write(created.getSessionFile()!, JSON.stringify(created.getHeader()) + "\n");
    const file = created.getSessionFile()!;
    const writable = SessionManager.open(file);
    writable.appendCustomEntry(INSTRUCTION_MODE_ENTRY, { mode: "normal" });
    const render = (manager: SessionManager) => {
      const pi = { registerCommand() {} } as any;
      const state = registerInstructionMode(pi, () => true);
      const ctx = { sessionManager: manager, ui: { setStatus() {}, notify() {} } } as any;
      state.sessionStart(ctx);
      return "base\n\n" + state.guidance(ctx, false);
    };
    const beforeRestart = render(SessionManager.open(file));
    const afterRestart = render(SessionManager.open(file));
    expect(afterRestart).toBe(beforeRestart);
    expect(afterRestart).toContain("main agent in normal instruction mode");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
