import { expect, test } from "bun:test";
import { mainAgentGuidance, replaceMainAgentGuidance } from "../src/prompts";
import { registerInstructionMode } from "../src/tasks/instruction-mode";

function fixture(root = true, entries: any[] = []) {
  let command: any;
  const appended: any[] = [], notices: any[] = [], statuses: any[] = [];
  const pi = {
    registerCommand(name: string, value: any) { if (name === "mode") command = value; },
    appendEntry(type: string, data: unknown) { appended.push({ type, data }); },
  } as any;
  const manager = { getEntries: () => entries, getSessionId: () => "session" };
  const ctx = { sessionManager: manager, ui: {
    notify: (message: string, kind: string) => notices.push({ message, kind }),
    setStatus: (key: string, value: string | undefined) => statuses.push({ key, value }),
  } } as any;
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

test("bounded mode replacement preserves framing before and after it", () => {
  const frame = "CUSTOM BEFORE\n" + mainAgentGuidance("orchestrator") + "\nCUSTOM AFTER";
  const switched = replaceMainAgentGuidance(frame, "normal");
  expect(switched).toStartWith("CUSTOM BEFORE");
  expect(switched).toEndWith("CUSTOM AFTER");
  expect(switched).toContain("main agent in normal instruction mode");
  expect(switched).not.toContain("main agent in orchestrator instruction mode");
  expect(replaceMainAgentGuidance("EXPLICIT CUSTOM", "fast")).toBe("EXPLICIT CUSTOM");
});
