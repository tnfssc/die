import { VOICE_MODEL } from "./types";

import type { LiveProviderId } from "./credentials";
export type { LiveProviderId } from "./credentials";
export const OPENAI_REALTIME_MODELS = ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"] as const;
export const OPENAI_LIVE_MODEL = "gpt-live-1";
export type LiveModelId = typeof VOICE_MODEL | (typeof OPENAI_REALTIME_MODELS)[number] | typeof OPENAI_LIVE_MODEL;

/** Voice selection is independent of the configured coding-agent model. GPT-Live needs its own transport. */
export const LIVE_PROVIDERS = {
  google: { label: "Google Gemini", models: [VOICE_MODEL] },
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
  previous: { provider: LiveProviderId; model: LiveModelId; openaiModel?: LiveModelId },
): LiveModelId {
  return provider === previous.provider
    ? previous.model
    : provider === "google"
      ? VOICE_MODEL
      : (previous.openaiModel ?? OPENAI_REALTIME_MODELS[0]);
}
export function unsupportedLiveTransport(model: LiveModelId): string | undefined {
  return model === OPENAI_LIVE_MODEL
    ? "OpenAI gpt-live-1 is selected but its transport is not supported yet; a separate GPT-Live implementation/design is required. Selection was kept."
    : undefined;
}
