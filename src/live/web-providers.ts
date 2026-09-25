import { VoiceSession } from "./session";
import { webGeminiAdapter } from "./web-gemini-adapter";
import { OpenAIRealtimeSession, type RealtimeSocketFactory } from "./openai-session";
import { OPENAI_REALTIME_MODELS, VOICE_MODEL } from "./providers";
import type { WebRelayProviderFactory } from "./web-relay";

export function createWebProviderFactory(
  provider: "google" | "openai",
  model: string,
  realtimeSocket?: RealtimeSocketFactory,
): WebRelayProviderFactory {
  if (provider === "google") {
    if (model !== VOICE_MODEL) throw new Error("Unsupported Gemini live model");
    return (callbacks, orchestration) => new VoiceSession(callbacks, webGeminiAdapter(), orchestration, model);
  }
  if (provider !== "openai" || !(OPENAI_REALTIME_MODELS as readonly string[]).includes(model))
    throw new Error("Unsupported OpenAI Realtime model");

  const realtimeModel = model as (typeof OPENAI_REALTIME_MODELS)[number];
  return (callbacks, orchestration) =>
    new OpenAIRealtimeSession(
      {
        ...callbacks,
        // The relay's Gemini-style transcript accumulator is for display semantics,
        // NOT an authority bridge for OpenAI. The GA adapter authorizes transcripts
        // by committed item ID and input revision, then captures them exactly once
        // through orchestration.userTranscript(). Never forward even a stale
        // transcription callback to the relay's accumulator.
        onInputTranscript: undefined,
      },
      realtimeSocket,
      orchestration,
      realtimeModel,
    );
}
