import {
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ModelSelectEvent,
} from "@earendil-works/pi-coding-agent";

export interface ModelDefaultSettings {
  setDefaultModelAndProvider(provider: string, modelId: string): void;
  flush(): Promise<void>;
  drainErrors(): Array<{ error: Error }>;
}

export type ModelDefaultSettingsFactory = (cwd: string) => ModelDefaultSettings;

function defaultSettingsFactory(cwd: string): ModelDefaultSettings {
  return SettingsManager.create(cwd);
}

/**
 * Save only a direct model choice from the root CLI TUI.
 *
 * Pi also emits model_select while restoring history. That describes session
 * state, not a request to change the startup default. Save keyboard cycle events
 * from the root TUI. Do not let worker or automation routing change the user's
 * default.
 */
export function isExplicitRootCliModelSelection(
  event: Pick<ModelSelectEvent, "source">,
  ctx: Pick<ExtensionContext, "mode">,
  isRootSession: boolean,
): boolean {
  return isRootSession && ctx.mode === "tui" && event.source !== "restore";
}

export function registerLastUsedCliModel(
  pi: ExtensionAPI,
  isRootSession: () => boolean,
  createSettings: ModelDefaultSettingsFactory = defaultSettingsFactory,
): void {
  pi.on("model_select", async (event, ctx) => {
    if (!isExplicitRootCliModelSelection(event, ctx, isRootSession())) return;

    const settings = createSettings(ctx.cwd);
    settings.setDefaultModelAndProvider(event.model.provider, event.model.id);
    await settings.flush();
    const errors = settings.drainErrors();
    if (errors.length > 0) {
      ctx.ui.notify(`Could not save default model: ${errors[0]!.error.message}`, "warning");
    }
  });
}
