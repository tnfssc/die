import { VOICE_MODEL } from "./types";
import { OPENAI_VOICE_MODEL } from "./openai-session";
import type { LiveProviderId } from "./credentials";

/** Voice model selection is independent of the configured coding-agent model. */
export const LIVE_PROVIDERS: Record<LiveProviderId, { label: string; voiceModel: string }> = {
  google: { label: "Google Gemini", voiceModel: VOICE_MODEL },
  openai: { label: "OpenAI", voiceModel: OPENAI_VOICE_MODEL },
};
