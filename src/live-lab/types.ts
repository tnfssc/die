import type { GoogleGenAI } from '@google/genai';

export const VOICE_MODEL = 'gemini-3.8-live' as const;
export type VoiceState = 'idle' | 'connecting' | 'ready' | 'closed';
export type VoiceError = { code: 'invalid_input' | 'connect_failed' | 'transport_error' | 'disconnected' | 'expiring' | 'invalid_audio'; message: string };
export interface VoiceCallbacks {
  onReady?: () => void;
  /** PCM 24 kHz base64; generation changes on interruption, so renderers must flush older audio. */
  onAudio?: (base64: string, generation: number) => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string, generation: number) => void;
  onInterrupted?: (generation: number) => void;
  onTurnComplete?: (generation: number) => void;
  onState?: (state: VoiceState) => void;
  onError?: (error: VoiceError) => void;
}
/** Narrow seam around the official SDK; tests inject this rather than opening a socket. */
export type LiveAdapter = (apiKey: string) => { live: Pick<GoogleGenAI['live'], 'connect'> };
export type LiveParams = Parameters<GoogleGenAI['live']['connect']>[0];
export type LiveConnection = Awaited<ReturnType<GoogleGenAI['live']['connect']>>;
