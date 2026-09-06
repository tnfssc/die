import { ModelRuntime, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AsyncLocalStorage } from "node:async_hooks";
import { lazyStream, type Model } from "@earendil-works/pi-ai";

export const NATIVE_FAST_ENTRY = "die-native-fast-mode";
const ENTRY_VERSION = 1;
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const standardTierScope = new AsyncLocalStorage<boolean>();

/** Keep only this asynchronous compaction request standard-priced. The owner is
 * retained for source compatibility; AsyncLocalStorage prevents concurrent
 * ordinary requests in the same session from inheriting the compaction tier. */
export async function withStandardProviderTier<T>(_owner: object, run: () => Promise<T>): Promise<T> {
  return standardTierScope.run(true, run);
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
export type FastEvidence = "requested";

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
function leafId(ctx: ExtensionContext): string | null {
  return (ctx.sessionManager as { getLeafId?: () => string | null }).getLeafId?.() ?? null;
}
function branch(ctx: ExtensionContext): any[] {
  const manager = ctx.sessionManager as { getBranch?: () => any[]; getEntries?: () => any[] };
  return manager.getBranch?.() ?? manager.getEntries?.() ?? [];
}
const MAX_ID_LENGTH = 256;
function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}
function setting(value: unknown): value is Setting {
  if (!record(value)) return false;
  return (
    value.version === ENTRY_VERSION &&
    boundedId(value.sessionId) &&
    boundedId(value.provider) &&
    boundedId(value.model) &&
    typeof value.enabled === "boolean" &&
    typeof value.costAcknowledged === "boolean" &&
    value.costAcknowledged === value.enabled &&
    typeof value.timestamp === "number" &&
    Number.isSafeInteger(value.timestamp) &&
    value.timestamp >= 0
  );
}
type SettingResolution = { kind: "valid"; value: Setting } | { kind: "invalid" } | { kind: "absent" };
function resolveSetting(
  ctx: ExtensionContext,
  model = ctx.model,
  sessionId = ctx.sessionManager.getSessionId(),
): SettingResolution {
  if (!model) return { kind: "absent" };
  const entries = branch(ctx);
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== NATIVE_FAST_ENTRY) continue;
    if (!record(entry.data)) return { kind: "invalid" };
    // If identity itself is corrupt it cannot safely be assigned to some other
    // scope. A well-formed identity for another scope may be skipped.
    if (!boundedId(entry.data.sessionId) || !boundedId(entry.data.provider) || !boundedId(entry.data.model))
      return { kind: "invalid" };
    // Identity fields are deliberately inspected before version/schema parsing:
    // the newest record for this exact scope is authoritative even when corrupt.
    if (entry.data.sessionId !== sessionId || entry.data.provider !== model.provider || entry.data.model !== model.id)
      continue;
    return setting(entry.data) ? { kind: "valid", value: entry.data } : { kind: "invalid" };
  }
  return { kind: "absent" };
}
function currentSetting(ctx: ExtensionContext, model = ctx.model): Setting | undefined {
  const found = resolveSetting(ctx, model);
  return found.kind === "valid" ? found.value : undefined;
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

function authSurfaceMatches(ctx: ExtensionContext, surface: "api" | "codex", model = ctx.model): boolean {
  const oauth = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
  return surface === "codex" ? oauth : !oauth;
}

function statusText(enabled: boolean, _evidence: FastEvidence): string {
  return enabled ? " fast requested (tier/cost estimate unavailable)" : " fast off";
}

type RequestAuthorization = {
  sessionId: string;
  provider: string;
  model: string;
  tier: "default" | "fast" | "priority";
  oauth: boolean;
  blocked?: string;
};
type FastController = {
  context?: ExtensionContext;
  capture(model: Model<any>, sessionId: unknown): RequestAuthorization | undefined;
};

const runtimeControllers = new WeakMap<object, FastController>();
const PATCHED_RUNTIME = Symbol.for("die.native-fast.runtime-patched");

/** Pi's extension emitter intentionally catches hook failures. Install a narrow
 * compatibility wrapper around ModelRuntime's final onPayload callback so a
 * rejected authorization cannot reach provider fetch even when a hook throws or
 * a subsequently loaded extension replaces the payload/tier. */
function installConcreteRequestGuard(): void {
  const prototype = ModelRuntime.prototype as any;
  if (prototype[PATCHED_RUNTIME]) return;
  const original = prototype.streamSimple;
  Object.defineProperty(prototype, PATCHED_RUNTIME, { value: true });
  prototype.streamSimple = function (model: Model<any>, context: unknown, options?: Record<string, any>) {
    const controller = runtimeControllers.get(this);
    const authorization = controller?.capture(model, options?.sessionId);
    if (!authorization) return original.call(this, model, context, options);
    const priorPayload = options?.onPayload;
    const guardedOptions = {
      ...options,
      // Supplying the typed option also lets Pi account for priority responses;
      // the payload guard below remains authoritative for the new API fast alias.
      serviceTier: authorization.tier,
      onPayload: async (payload: unknown, payloadModel: Model<any>) => {
        const finalPayload = priorPayload ? await priorPayload(payload, payloadModel) : payload;
        if (authorization.blocked) throw new Error(authorization.blocked);
        if (!record(finalPayload))
          throw new Error("Native fast mode rejected a non-object provider payload before dispatch.");
        if (finalPayload.model !== authorization.model)
          throw new Error("Native fast mode rejected a provider payload for a different model before dispatch.");
        if (finalPayload.service_tier !== authorization.tier)
          throw new Error("Native fast mode rejected a late service-tier mutation before dispatch.");
        return finalPayload;
      },
    };
    // Reproduce ModelRuntime's three-line lazy dispatch only for a scoped fast
    // setting, exposing the already-supported private preparation seam so the
    // actual provider, endpoint, and resolved auth snapshot are checked before
    // provider.streamSimple can be invoked.
    return lazyStream(model, async () => {
      const prepared = await this.prepareRequest(model, guardedOptions);
      if (
        prepared.provider.id !== authorization.provider ||
        prepared.model.provider !== authorization.provider ||
        prepared.model.id !== authorization.model ||
        this.isUsingOAuth(authorization.provider) !== authorization.oauth
      )
        throw new Error("Native fast mode request identity or authentication changed before provider dispatch.");
      if (authorization.tier !== "default") {
        const actualSupport = nativeFastSupport(prepared.model);
        if (!actualSupport.supported || actualSupport.tier !== authorization.tier)
          throw new Error("Native fast mode actual provider endpoint is not authorized for this request.");
      }
      return prepared.provider.streamSimple(prepared.model, context, prepared.options);
    });
  };
}
installConcreteRequestGuard();

export function registerNativeFastMode(pi: ExtensionAPI) {
  let ui: ExtensionContext["ui"] | undefined;
  let evidence: FastEvidence = "requested";
  const controller: FastController = {
    capture(model, requestedSessionId) {
      const ctx = controller.context;
      if (!ctx || typeof requestedSessionId !== "string") return;
      if (standardTierScope.getStore() && officialSurface(model)) {
        return {
          sessionId: requestedSessionId,
          provider: model.provider,
          model: model.id,
          tier: "default",
          oauth: ctx.modelRegistry.isUsingOAuth(model),
        };
      }
      const found = resolveSetting(ctx, model, requestedSessionId);
      if (found.kind === "absent") return;
      if (found.kind === "invalid")
        return {
          sessionId: requestedSessionId,
          provider: model.provider,
          model: model.id,
          tier: "default",
          oauth: ctx.modelRegistry.isUsingOAuth(model),
          blocked: "Native fast mode rejected a malformed or unsupported authorization record before dispatch.",
        };
      const active = found.value;
      if (!active.enabled) {
        return {
          sessionId: requestedSessionId,
          provider: model.provider,
          model: model.id,
          tier: "default",
          oauth: ctx.modelRegistry.isUsingOAuth(model),
          ...(officialSurface(model)
            ? {}
            : { blocked: "Native fast opt-out no longer matches an official provider surface." }),
        };
      }
      const support = nativeFastSupport(model);
      const blocked = !active.costAcknowledged
        ? "Native fast mode authorization is missing; run /fast on again."
        : !support.supported
          ? support.reason
          : !authSurfaceMatches(ctx, support.surface, model)
            ? support.surface === "codex"
              ? "Codex fast mode requires ChatGPT OAuth sign-in."
              : "OpenAI API fast mode requires API-key authentication."
            : undefined;
      return {
        sessionId: requestedSessionId,
        provider: model.provider,
        model: model.id,
        tier: support.supported ? support.tier : "default",
        oauth: ctx.modelRegistry.isUsingOAuth(model),
        ...(blocked ? { blocked } : {}),
      };
    },
  };
  let boundRuntime: object | undefined;
  const bindContext = (ctx: ExtensionContext) => {
    controller.context = ctx;
    const runtime = (ctx.modelRegistry as unknown as { runtime?: object }).runtime;
    if (boundRuntime && boundRuntime !== runtime) runtimeControllers.delete(boundRuntime);
    boundRuntime = runtime;
    if (runtime) runtimeControllers.set(runtime, controller);
  };
  pi.registerFlag("accept-cost", {
    type: "boolean",
    description: "Acknowledge premium provider billing when enabling /fast outside the TUI",
    default: false,
  });
  const refreshStatus = (ctx: ExtensionContext) => {
    bindContext(ctx);
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
      bindContext(ctx);
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
      const consentScope = {
        sessionId: ctx.sessionManager.getSessionId(),
        leafId: leafId(ctx),
        provider: model.provider,
        model: model.id,
      };
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
      const currentModel = ctx.model;
      if (
        !currentModel ||
        ctx.sessionManager.getSessionId() !== consentScope.sessionId ||
        leafId(ctx) !== consentScope.leafId ||
        currentModel.provider !== consentScope.provider ||
        currentModel.id !== consentScope.model
      ) {
        ctx.ui.notify(
          "Fast mode consent became stale because the session, branch, or model changed; nothing was enabled.",
          "warning",
        );
        return;
      }
      if (action === "on" && (!support.supported || !authSurfaceMatches(ctx, support.surface, currentModel))) {
        ctx.ui.notify(
          "Fast mode consent became stale because the authentication surface changed; nothing was enabled.",
          "warning",
        );
        return;
      }
      const entry: Setting = {
        version: ENTRY_VERSION,
        sessionId: consentScope.sessionId,
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

  // This hook requests the tier for direct provider users. ModelRuntime's final
  // payload wrapper independently validates it after every extension hook; this
  // hook never relies on a swallowed exception for safety.
  pi.on("before_provider_request", (event, ctx) => {
    bindContext(ctx);
    const model = ctx.model;
    if (!model || !record(event.payload)) {
      return;
    }
    if (standardTierScope.getStore()) {
      if (officialSurface(model)) event.payload.service_tier = "default";
      return event.payload;
    }
    const found = resolveSetting(ctx, model);
    if (found.kind === "absent") {
      return;
    }
    if (found.kind === "invalid") {
      if (officialSurface(model)) event.payload.service_tier = "default";
      refreshStatus(ctx);
      return event.payload;
    }
    const active = found.value;
    if (!active.enabled) {
      if (officialSurface(model)) event.payload.service_tier = "default";
      return event.payload;
    }
    const support = nativeFastSupport(model);
    if (!active.costAcknowledged || !support.supported || !authSurfaceMatches(ctx, support.surface, model)) {
      event.payload.service_tier = "default";
      return event.payload;
    }
    event.payload.service_tier = support.tier;
    evidence = "requested";
    refreshStatus(ctx);
    return event.payload;
  });
  pi.on("session_start", (_event, ctx) => {
    evidence = "requested";
    refreshStatus(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    evidence = "requested";
    refreshStatus(ctx);
  });
  pi.on("session_shutdown", () => {
    ui?.setStatus("die-native-fast", undefined);
    if (boundRuntime) runtimeControllers.delete(boundRuntime);
    boundRuntime = undefined;
    controller.context = undefined;
    ui = undefined;
  });
  return { refreshStatus, currentSetting };
}
