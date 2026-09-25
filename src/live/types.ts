import type { FunctionDeclaration, GoogleGenAI } from "@google/genai";

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
export type VoiceTranscript = {
  text: string;
  /** Semantic finality. Absence remains unknown for unsupported models. */
  finished?: boolean;
  rawFinished?: boolean;
  finalitySource?: "provider" | "model_contract";
  languageCode?: string;
  speakerLabel?: string;
  /** Output from a cancelled model envelope, not verified playback. */
  interrupted?: boolean;
};
export interface VoiceCallbacks {
  onReady?: () => void;
  /** Cumulative PCM milliseconds actually played in the current playback epoch. */
  getPlayedAudioMs?: () => number;
  /** Base64 PCM16 mono 24 kHz. playbackEpoch changes ONLY on interruption; flush queued playback on onInterrupted. */
  onAudio?: (base64: string, playbackEpoch: number) => void;
  /** Known incoming activity/interim text revokes older input; never proves finality. */
  onInputActivity?: () => void;
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
  /** Revoke pending authority on fresh input or interruption, not model turn completion. */
  beginUserTurn?(): void;
  execute(call: { id?: string; name?: string; args?: Record<string, unknown> }): Promise<unknown>;
}

/** Shared single-use provider contract; callbacks retain the same playback epoch semantics. */
export interface VoiceProvider {
  readonly state: VoiceState;
  readonly generation: number;
  readonly turn: number;
  connect(apiKey: string): Promise<void>;
  sendAudio(base64: string): void;
  endAudio(): void;
  sendContext(text: string): void;
  close(): void;
}
