import { VoiceSession } from "./session";
import { webGeminiAdapter } from "./web-gemini-adapter";
import { OpenAIRealtimeSession, defaultSocket, type RealtimeSocket, type RealtimeSocketFactory } from "./openai-session";
import { OPENAI_REALTIME_MODELS, VOICE_MODEL } from "./providers";
import type { WebRelayProviderFactory } from "./web-relay";

export function createWebProviderFactory(
  provider: "google" | "openai",
  model: string,
  realtimeSocket?: RealtimeSocketFactory,
): WebRelayProviderFactory {
  if (provider === "google") {
    if (model !== VOICE_MODEL) throw new Error("Unsupported Gemini live model");
    return (callbacks, orchestration) => {
      const adapter = webGeminiAdapter();
      const session = new VoiceSession(callbacks, adapter, orchestration, model);
      return Object.assign(session, { shutdown: async () => { session.close(); await adapter.shutdown(); } });
    };
  }
  if (provider !== "openai" || !(OPENAI_REALTIME_MODELS as readonly string[]).includes(model))
    throw new Error("Unsupported OpenAI Realtime model");

  const realtimeModel = model as (typeof OPENAI_REALTIME_MODELS)[number];
  return (callbacks, orchestration) => {
    let socket: RealtimeSocket | undefined;
    const session = new OpenAIRealtimeSession(
      {
        ...callbacks,
        // The relay's Gemini-style transcript accumulator is for display semantics,
        // NOT an authority bridge for OpenAI. The GA adapter authorizes transcripts
        // by committed item ID and input revision, then captures them exactly once
        // through orchestration.userTranscript(). Never forward even a stale
        // transcription callback to the relay's accumulator.
        onInputTranscript: undefined,
      },
      (url, headers) => {
        socket = (realtimeSocket ?? defaultSocket)(url, headers);
        return socket;
      },
      orchestration,
      realtimeModel,
    );
    return Object.assign(session, {
      async shutdown() {
        session.close();
        if (session.closeError) throw new Error(session.closeError);
        const current = socket;
        if (!current) return;
        if (current.shutdown) return current.shutdown();
        // Injected socket factories may not expose shutdown. Verify the observable
        // close state/event, never treat the synchronous close call as proof.
        if (current.readyState === 3) return;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("OpenAI socket shutdown not observed")), 2500);
          current.addEventListener("close", () => { clearTimeout(timer); resolve(); });
          if (current.readyState === 3) { clearTimeout(timer); resolve(); }
        });
      },
    });
  };
}
