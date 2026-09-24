import type { FunctionDeclaration, GoogleGenAI } from "@google/genai";

export const VOICE_MODEL = "gemini-3.8-live" as const;
export type VoiceState = "idle" | "connecting" | "ready" | "closed";
export type VoiceError = {
  code:
    | "invalid_input"
    | "connect_failed"
    | "transport_error"
    | "disconnected"
    | "expiring"
    | "invalid_audio"
    | "transcript_limit";
  message: string;
};
export type VoiceTranscript = { text: string; finished?: boolean; languageCode?: string; speakerLabel?: string };
export interface VoiceCallbacks {
  onReady?: () => void;
  /** Base64 PCM16 mono 24 kHz. playbackEpoch changes ONLY on interruption; flush queued playback on onInterrupted. */
  onAudio?: (base64: string, playbackEpoch: number) => void;
  onInputTranscript?: (transcript: VoiceTranscript) => void;
  onOutputTranscript?: (transcript: VoiceTranscript, playbackEpoch: number) => void;
  onInterrupted?: (playbackEpoch: number) => void;
  /** turn is a monotonic turn identifier, not a reason to flush playback. */
  onTurnComplete?: (turn: number) => void;
  onState?: (state: VoiceState) => void;
  onError?: (error: VoiceError) => void;
}
/** Narrow seam around the official SDK; tests inject this rather than opening a socket. */
export type LiveAdapter = (apiKey: string) => { live: Pick<GoogleGenAI["live"], "connect"> };
export type LiveParams = Parameters<GoogleGenAI["live"]["connect"]>[0];
export type LiveConnection = Awaited<ReturnType<GoogleGenAI["live"]["connect"]>>;

/** Tool calls belong to the model; host job updates use sendContext, never tool responses. */
export interface VoiceOrchestration {
  tools: FunctionDeclaration[];
  /** Completed input speech only; never host updates or model output. */
  userTranscript(text: string): void;
  execute(call: { id?: string; name?: string; args?: Record<string, unknown> }): Promise<unknown>;
}
