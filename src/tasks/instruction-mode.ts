import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MAIN_AGENT_MODES, replaceMainAgentGuidance, type MainAgentMode } from "../prompts";
import { updateCurrentInstructionFrame } from "./cache-affine-compaction";

export const INSTRUCTION_MODE_ENTRY = "die-instruction-mode";

function parsedMode(value: string): MainAgentMode | undefined {
  return MAIN_AGENT_MODES.includes(value as MainAgentMode) ? value as MainAgentMode : undefined;
}

function persistedMode(ctx: ExtensionContext): MainAgentMode {
  const entries = ctx.sessionManager?.getEntries() ?? [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== INSTRUCTION_MODE_ENTRY) continue;
    const mode = parsedMode((entry.data as { mode?: unknown } | undefined)?.mode as string);
    if (mode) return mode;
  }
  return "orchestrator";
}

/** Session-scoped root behavior. Child identity remains process/session metadata. */
export function registerInstructionMode(pi: ExtensionAPI, isRoot: () => boolean) {
  let mode: MainAgentMode = "orchestrator";
  let ui: ExtensionContext["ui"] | undefined;
  const status = () => ui?.setStatus("die-mode", isRoot() ? "mode: " + mode : undefined);
  const describe = () => mode + " (instructions only; model and thinking unchanged)";

  pi.registerCommand("mode", {
    description: "Show or switch main-agent instruction mode (fast, normal, orchestrator)",
    getArgumentCompletions: prefix => {
      const value = prefix.trim().toLowerCase();
      if (MAIN_AGENT_MODES.includes(value as MainAgentMode)) return null;
      return MAIN_AGENT_MODES.filter(mode => mode.startsWith(value)).map(mode => ({ value: mode, label: mode }));
    },
    handler: async (args, ctx) => {
      ui = ctx.ui;
      if (!isRoot()) {
        ctx.ui.notify("/mode is available only to the main agent; this child keeps its fixed role and delegation depth.", "warning");
        return;
      }
      const requested = args.trim().toLowerCase();
      if (!requested) {
        ctx.ui.notify("Main-agent mode: " + describe() + ". Use /mode fast|normal|orchestrator.", "info");
        status();
        return;
      }
      const next = parsedMode(requested);
      if (!next) {
        ctx.ui.notify("Usage: /mode fast|normal|orchestrator", "error");
        return;
      }
      if (next !== mode) {
        mode = next;
        pi.appendEntry(INSTRUCTION_MODE_ENTRY, { mode });
        // Custom task notifications bypass before_agent_start. Rewrite the one
        // already-prepared frame once so they cannot revive the previous mode;
        // arbitrary extension framing hooks are not re-run here or per tool.
        updateCurrentInstructionFrame(ctx.sessionManager as object, prompt => replaceMainAgentGuidance(prompt, mode));
      }
      status();
      ctx.ui.notify("Main-agent mode: " + describe() + ".", "info");
    },
  });

  return {
    get: () => mode,
    refresh(ctx: ExtensionContext) {
      mode = isRoot() ? persistedMode(ctx) : "orchestrator";
    },
    sessionStart(ctx: ExtensionContext) {
      ui = ctx.ui;
      mode = isRoot() ? persistedMode(ctx) : "orchestrator";
      status();
    },
    shutdown() { ui?.setStatus("die-mode", undefined); ui = undefined; },
  };
}
