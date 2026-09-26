import type { LiveProviderId } from "./credentials";
export type { LiveProviderId } from "./credentials";
export const VOICE_MODEL = "gemini-3.8-live" as const;
export const GOOGLE_LIVE_MODELS = [VOICE_MODEL, "gemini-3.8-live-extended-thinking"] as const;
export const OPENAI_REALTIME_MODELS = ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"] as const;
export const OPENAI_LIVE_MODEL = "gpt-live-1";
export type LiveModelId =
  | (typeof GOOGLE_LIVE_MODELS)[number]
  | (typeof OPENAI_REALTIME_MODELS)[number]
  | typeof OPENAI_LIVE_MODEL;

/** Voice selection is independent of the configured coding-agent model. GPT-Live uses the selected coding agent as its client-delegated backend. */
export const LIVE_PROVIDERS = {
  google: { label: "Google Gemini", models: [...GOOGLE_LIVE_MODELS] },
  openai: { label: "OpenAI", models: [...OPENAI_REALTIME_MODELS, OPENAI_LIVE_MODEL] },
} as const;
export function isLiveModel(provider: LiveProviderId, model: unknown): model is LiveModelId {
  return typeof model === "string" && (LIVE_PROVIDERS[provider].models as readonly string[]).includes(model);
}
export function defaultLiveConfig(): { provider: LiveProviderId; model: LiveModelId } {
  return { provider: "google", model: VOICE_MODEL };
}
export function modelForProvider(
  provider: LiveProviderId,
  previous: {
    provider: LiveProviderId;
    model: LiveModelId;
    openaiModel?: (typeof LIVE_PROVIDERS.openai.models)[number];
    googleModel?: (typeof GOOGLE_LIVE_MODELS)[number];
  },
): LiveModelId {
  return provider === previous.provider
    ? previous.model
    : provider === "google"
      ? (previous.googleModel ?? VOICE_MODEL)
      : (previous.openaiModel ?? OPENAI_REALTIME_MODELS[0]);
}
