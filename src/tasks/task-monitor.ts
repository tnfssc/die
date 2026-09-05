import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskManager } from "./task-manager";
import { TaskMonitorPanel } from "../ui/task-monitor";

/** Register /ps against the same lazily-created manager used by execute jobs. */
export function registerTaskMonitor(pi: ExtensionAPI, getManager: () => TaskManager): void {
  pi.registerCommand("ps", {
    description: "Monitor and stop running session jobs",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/ps is available in interactive mode", "warning");
        return;
      }
      await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
        let panel: TaskMonitorPanel;
        panel = new TaskMonitorPanel(
          getManager(),
          theme,
          keybindings,
          () => done(),
          () => tui.requestRender(),
          () => tui.terminal.rows,
        );
        return panel;
      });
    },
  });
}
