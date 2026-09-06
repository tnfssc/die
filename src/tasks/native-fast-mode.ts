import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

export const NATIVE_FAST_ENTRY = "die-native-fast-mode";
const ENTRY_VERSION = 1;
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const standardTierScopes = new WeakMap<object, number>();

/** Keep compaction standard-priced through the same pre-capture payload seam. */
export async function withStandardProviderTier<T>(owner: object, run: () => Promise<T>): Promise<T> {
  standardTierScopes.set(owner, (standardTierScopes.get(owner) ?? 0) + 1);
  try {
    return await run();
  } finally {
    const remaining = (standardTierScopes.get(owner) ?? 1) - 1;
    if (remaining > 0) standardTierScopes.set(owner, remaining);
    else standardTierScopes.delete(owner);
  }
}

// Exact model aliases evidenced by the provider documentation/source snapshot.
// Do not broaden these with family-prefix matching: similarly named mini/Spark
// models do not inherit native fast-mode support.
export const OPENAI_FAST_MODELS = new Set(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.3-codex"]);
export const CODEX_FAST_MODELS = new Set([
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
]);

type Setting = {
  version: 1;
  sessionId: string;
  provider: string;
  model: string;
  enabled: boolean;
  costAcknowledged: boolean;
  timestamp: number;
};
export type FastEvidence = "requested" | "confirmed" | "default-downgrade" | "unknown";

type Payload = Record<string, unknown>;
function record(value: unknown): value is Payload {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function normalizedUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
function officialSurface(model: Pick<Model<any>, "provider" | "api" | "baseUrl">): boolean {
  return (
    (model.provider === "openai" &&
      model.api === "openai-responses" &&
      normalizedUrl(model.baseUrl) === OPENAI_BASE_URL) ||
    (model.provider === "openai-codex" &&
      model.api === "openai-codex-responses" &&
      normalizedUrl(model.baseUrl) === CODEX_BASE_URL)
  );
}
function branch(ctx: ExtensionContext): any[] {
  const manager = ctx.sessionManager as { getBranch?: () => any[]; getEntries?: () => any[] };
  return manager.getBranch?.() ?? manager.getEntries?.() ?? [];
}
function setting(value: unknown): value is Setting {
  if (!record(value)) return false;
  return (
    value.version === ENTRY_VERSION &&
    typeof value.sessionId === "string" &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.costAcknowledged === "boolean" &&
    typeof value.timestamp === "number"
  );
}
function currentSetting(ctx: ExtensionContext, model = ctx.model): Setting | undefined {
  if (!model) return undefined;
  const sessionId = ctx.sessionManager.getSessionId();
  const entries = branch(ctx);
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== NATIVE_FAST_ENTRY || !setting(entry.data)) continue;
    if (entry.data.sessionId === sessionId && entry.data.provider === model.provider && entry.data.model === model.id)
      return entry.data;
  }
  return undefined;
}

export function nativeFastSupport(
  model: Pick<Model<any>, "provider" | "id" | "api" | "baseUrl">,
): { supported: true; tier: "fast" | "priority"; surface: "api" | "codex" } | { supported: false; reason: string } {
  const baseUrl = normalizedUrl(model.baseUrl);
  if (model.provider === "openai") {
    if (model.api !== "openai-responses" || baseUrl !== OPENAI_BASE_URL)
      return {
        supported: false,
        reason: "OpenAI native fast mode requires the official openai Responses endpoint and auth surface.",
      };
    if (!OPENAI_FAST_MODELS.has(model.id))
      return { supported: false, reason: `OpenAI native fast mode is not documented for model alias "${model.id}".` };
    return { supported: true, tier: "fast", surface: "api" };
  }
  if (model.provider === "openai-codex") {
    if (model.api !== "openai-codex-responses" || baseUrl !== CODEX_BASE_URL)
      return {
        supported: false,
        reason: "Codex native fast mode requires ChatGPT sign-in on the official Codex endpoint.",
      };
    if (!CODEX_FAST_MODELS.has(model.id))
      return { supported: false, reason: `Codex native fast mode is not evidenced for model alias "${model.id}".` };
    // The official Codex client maps its user-facing Fast tier to this legacy
    // wire value. OpenAI documents priority and fast as equivalent.
    return { supported: true, tier: "priority", surface: "codex" };
  }
  if (model.provider === "anthropic")
    return {
      supported: false,
      reason:
        "Anthropic native fast mode is deferred: it requires speed=fast plus the fast-mode-2026-02-01 beta header; effort is not a substitute.",
    };
  return {
    supported: false,
    reason: "Native fast mode currently supports only official OpenAI API and Codex provider surfaces.",
  };
}

function authSurfaceMatches(ctx: ExtensionContext, surface: "api" | "codex"): boolean {
  const oauth = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
  return surface === "codex" ? oauth : !oauth;
}

function statusText(enabled: boolean, evidence: FastEvidence): string {
  if (!enabled) return " fast off";
  if (evidence === "confirmed") return " fast confirmed";
  if (evidence === "default-downgrade") return " standard (fast downgraded)";
  if (evidence === "unknown") return " fast requested (tier unknown)";
  return " fast requested (unconfirmed)";
}

export function registerNativeFastMode(pi: ExtensionAPI) {
  let ui: ExtensionContext["ui"] | undefined;
  let evidence: FastEvidence = "requested";
  let lastRequest: { provider: string; model: string } | undefined;
  pi.registerFlag("accept-cost", {
    type: "boolean",
    description: "Acknowledge premium provider billing when enabling /fast outside the TUI",
    default: false,
  });
  const refreshStatus = (ctx: ExtensionContext) => {
    ui = ctx.ui;
    const active = currentSetting(ctx);
    ui?.setStatus(
      "die-native-fast",
      active ? statusText(active.enabled, active.enabled ? evidence : "requested") : undefined,
    );
  };

  pi.registerCommand("fast", {
    description: "Show or set opt-in provider-native fast mode (on, off, status)",
    getArgumentCompletions: (prefix) => {
      const value = prefix.trim().toLowerCase();
      return ["on", "off", "status"].filter((item) => item.startsWith(value)).map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";
      if (action === "status") {
        const active = currentSetting(ctx);
        const description = !active
          ? "off (no model-bound setting in this session)"
          : active.enabled
            ? statusText(true, evidence).replace(/^ /, "") +
              "; response-tier evidence is unavailable until the runtime exposes it"
            : "off (explicit default/standard tier)";
        ctx.ui.notify(`Native fast mode: ${description}. Model and thinking are unchanged.`, "info");
        refreshStatus(ctx);
        return;
      }
      if (action !== "on" && action !== "off") {
        ctx.ui.notify("Usage: /fast on|off|status", "error");
        return;
      }
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("Select a model before changing native fast mode.", "error");
        return;
      }
      const support = nativeFastSupport(model);
      if (action === "off" && !officialSurface(model)) {
        ctx.ui.notify(
          "Native fast opt-out applies only to the official OpenAI API and Codex provider surfaces.",
          "error",
        );
        return;
      }
      if (action === "on" && !support.supported) {
        ctx.ui.notify(support.reason, "error");
        return;
      }
      if (action === "on") {
        if (!support.supported || !authSurfaceMatches(ctx, support.surface)) {
          ctx.ui.notify(
            support.supported && support.surface === "codex"
              ? "Codex fast mode requires ChatGPT OAuth sign-in; API-key traffic uses the OpenAI API pricing surface."
              : "OpenAI API fast mode requires the API-key auth surface.",
            "error",
          );
          return;
        }
        let accepted = pi.getFlag("accept-cost") === true;
        if (!accepted && ctx.mode === "tui")
          accepted = await ctx.ui.confirm(
            "Enable premium fast mode?",
            support.supported && support.surface === "codex"
              ? "Fast mode consumes more ChatGPT credits (model-dependent, currently 2x or 2.5x). Provider billing is authoritative."
              : "Fast mode uses premium API token pricing. Provider billing is authoritative.",
          );
        if (!accepted) {
          ctx.ui.notify("Fast mode was not enabled. Use the TUI confirmation or launch with --accept-cost.", "warning");
          return;
        }
      }
      const entry: Setting = {
        version: ENTRY_VERSION,
        sessionId: ctx.sessionManager.getSessionId(),
        provider: model.provider,
        model: model.id,
        enabled: action === "on",
        costAcknowledged: action === "on",
        timestamp: Date.now(),
      };
      try {
        pi.appendEntry(NATIVE_FAST_ENTRY, entry);
      } catch (error) {
        ctx.ui.notify(
          "Could not persist native fast mode: " + (error instanceof Error ? error.message : String(error)),
          "error",
        );
        return;
      }
      evidence = "requested";
      refreshStatus(ctx);
      ctx.ui.notify(
        action === "on"
          ? "Native fast mode requested for this session and model. Actual response tier is not exposed by this runtime."
          : "Native fast mode off for this session and model; requests explicitly use the default/standard tier.",
        "info",
      );
    },
  });

  // Register this before request-capture hooks. Mutating the actual serialized
  // payload is deliberate: Pi 0.85 streamSimple drops serviceTier while adapting
  // options, whereas both low-level Responses transports serialize service_tier.
  pi.on("before_provider_request", (event, ctx) => {
    if (!ctx.model) return;
    if (standardTierScopes.has(ctx.sessionManager as object)) {
      if (!record(event.payload)) throw new Error("Standard-tier compaction requires an object provider payload.");
      if (officialSurface(ctx.model)) event.payload.service_tier = "default";
      return event.payload;
    }
    const active = currentSetting(ctx);
    if (!active) return;
    if (!record(event.payload)) throw new Error("Native fast mode requires an object provider payload.");
    if (!active.enabled) {
      if (officialSurface(ctx.model)) event.payload.service_tier = "default";
      return event.payload;
    }
    if (!active.costAcknowledged) throw new Error("Native fast mode authorization is missing; run /fast on again.");
    const support = nativeFastSupport(ctx.model);
    if (!support.supported) throw new Error(support.reason);
    if (!authSurfaceMatches(ctx, support.surface))
      throw new Error(
        support.surface === "codex"
          ? "Codex fast mode requires ChatGPT OAuth sign-in."
          : "OpenAI API fast mode requires API-key authentication.",
      );
    event.payload.service_tier = support.tier;
    evidence = "requested";
    lastRequest = { provider: ctx.model.provider, model: ctx.model.id };
    refreshStatus(ctx);
    return event.payload;
  });
  pi.on("after_provider_response", (event, ctx) => {
    if (!lastRequest || !ctx.model || lastRequest.provider !== ctx.model.provider || lastRequest.model !== ctx.model.id)
      return;
    const tier = (event as typeof event & { serviceTier?: unknown }).serviceTier;
    evidence =
      tier === "fast" || tier === "priority" ? "confirmed" : tier === "default" ? "default-downgrade" : "unknown";
    refreshStatus(ctx);
  });
  pi.on("session_start", (_event, ctx) => {
    evidence = "requested";
    lastRequest = undefined;
    refreshStatus(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    evidence = "requested";
    lastRequest = undefined;
    refreshStatus(ctx);
  });
  pi.on("session_shutdown", () => {
    ui?.setStatus("die-native-fast", undefined);
    ui = undefined;
    lastRequest = undefined;
  });
  return { refreshStatus, currentSetting };
}
