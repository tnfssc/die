import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MAIN_AGENT_MODES, mainAgentGuidance, replaceMainAgentGuidance, type MainAgentMode } from "../prompts";
import { updateCurrentInstructionFrame } from "./cache-affine-compaction";

export const INSTRUCTION_MODE_ENTRY = "die-instruction-mode";

function parsedMode(value: unknown): MainAgentMode | undefined {
  return typeof value === "string" && MAIN_AGENT_MODES.includes(value as MainAgentMode) ? value as MainAgentMode : undefined;
}

function activeEntries(ctx: ExtensionContext): any[] {
  const manager = ctx.sessionManager as { getBranch?: () => any[]; getEntries?: () => any[] } | undefined;
  return manager?.getBranch?.() ?? manager?.getEntries?.() ?? [];
}

function persistedMode(ctx: ExtensionContext): MainAgentMode {
  const entries = activeEntries(ctx);
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== INSTRUCTION_MODE_ENTRY) continue;
    const mode = parsedMode((entry.data as { mode?: unknown } | undefined)?.mode);
    if (mode) return mode;
  }
  return "orchestrator";
}

/** Session-scoped root behavior. Child identity remains process/session metadata. */
export function registerInstructionMode(pi: ExtensionAPI, isRoot: () => boolean) {
  let mode: MainAgentMode = "orchestrator";
  let ui: ExtensionContext["ui"] | undefined;
  let owner = randomUUID();
  let sessionId: string | undefined;
  let explicitCustom = false;
  const status = () => ui?.setStatus("die-mode", isRoot() ? "mode: " + mode : undefined);
  const describe = () => mode + " (instructions only; model and thinking unchanged)";
  const resetFrameIdentity = (ctx: ExtensionContext) => {
    const nextId = ctx.sessionManager?.getSessionId?.();
    if (nextId !== sessionId) {
      sessionId = nextId;
      owner = randomUUID();
      explicitCustom = false;
    }
  };

  pi.registerCommand("mode", {
    description: "Show or switch main-agent instruction mode (fast, normal, orchestrator)",
    getArgumentCompletions: prefix => {
      const value = prefix.trim().toLowerCase();
      if (MAIN_AGENT_MODES.includes(value as MainAgentMode)) return null;
      return MAIN_AGENT_MODES.filter(mode => mode.startsWith(value)).map(mode => ({ value: mode, label: mode }));
    },
    handler: async (args, ctx) => {
      ui = ctx.ui;
      resetFrameIdentity(ctx);
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
        // Persistence is the commit point. A failed append must not leave the
        // in-memory status or prepared instruction frame ahead of durable state.
        try {
          pi.appendEntry(INSTRUCTION_MODE_ENTRY, { mode: next });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          ctx.ui.notify("Could not persist main-agent mode: " + reason, "error");
          return;
        }
        mode = next;
        if (!explicitCustom) {
          updateCurrentInstructionFrame(ctx.sessionManager as object, prompt => replaceMainAgentGuidance(prompt, mode, owner));
        }
      }
      status();
      ctx.ui.notify("Main-agent mode: " + describe() + ".", "info");
    },
  });

  return {
    get: () => mode,
    /** Record whether this frame is a user override and create die's owned block. */
    guidance(ctx: ExtensionContext, custom: boolean): string {
      resetFrameIdentity(ctx);
      explicitCustom = custom;
      return custom ? "" : mainAgentGuidance(mode, owner);
    },
    refresh(ctx: ExtensionContext) {
      resetFrameIdentity(ctx);
      mode = isRoot() ? persistedMode(ctx) : "orchestrator";
    },
    sessionStart(ctx: ExtensionContext) {
      ui = ctx.ui;
      resetFrameIdentity(ctx);
      mode = isRoot() ? persistedMode(ctx) : "orchestrator";
      status();
    },
    shutdown() { ui?.setStatus("die-mode", undefined); ui = undefined; explicitCustom = false; },
  };
}
