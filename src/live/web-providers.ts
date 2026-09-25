import { OpenAIRealtimeSession, type RealtimeSocketFactory } from "./openai-session";
import { OPENAI_REALTIME_MODELS, VOICE_MODEL } from "./providers";
import type { WebRelayProviderFactory } from "./web-relay";

/**
 * Server-side provider selection for the web PCM relay. No key is captured here: the
 * relay supplies its server-side key directly to VoiceProvider.connect().
 *
 * Do not expose Gemini through this relay yet. VoiceSession.sendAudio() calls the
 * Google SDK's sendRealtimeInput() synchronously without a bufferedAmount, drain,
 * or other backpressure signal. The relay's bounded browser socket does not bound
 * that upstream SDK queue. Nor does GPT-Live implement the GA Realtime protocol.
 */
export function createWebProviderFactory(
  provider: "google" | "openai",
  model: string,
  realtimeSocket?: RealtimeSocketFactory,
): WebRelayProviderFactory {
  if (provider === "google") {
    if (model !== VOICE_MODEL) throw new Error("Unsupported Gemini live model");
    throw new Error("Gemini web relay unavailable: SDK upstream audio buffering has no observable bound");
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
