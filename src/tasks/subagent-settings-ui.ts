import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadProfiles, saveProfiles, profilesPath, type Profiles } from "./subagent-profiles";
import { SubagentSettingsPanel } from "../ui/subagent-settings";

/** The optional path isolates settings in tests; production uses the user profile file. */
export function registerSubagentSettings(pi: ExtensionAPI, path = profilesPath()): void {
  pi.registerCommand("subagents", {
    description: "Configure sub-agent profiles with a searchable model picker",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Use /subagents in the TUI, or edit " + path, "info");
        return;
      }
      try {
        const profiles = await loadProfiles(path);
        const result = await ctx.ui.custom<Profiles | undefined>(
          (tui, theme, keys, done) =>
            new SubagentSettingsPanel(
              profiles,
              ctx.modelRegistry.getAvailable(),
              theme,
              keys,
              done,
              () => tui.requestRender(),
              ctx.model ? ctx.model.provider + "/" + ctx.model.id : undefined,
              ctx.thinkingLevel,
            ),
        );
        if (!result) return;
        await saveProfiles(result, path);
        ctx.ui.notify("Saved " + path + ". Applies to future sub-agents.", "info");
      } catch (error) {
        ctx.ui.notify("Could not configure sub-agents: " + String(error), "error");
      }
    },
  });
}
