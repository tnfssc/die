import { GoogleGenAI, Modality } from '@google/genai';
import { VOICE_MODEL, type LiveAdapter, type LiveConnection, type LiveParams, type VoiceCallbacks, type VoiceError, type VoiceState } from './types.js';

// 100 ms of 16 kHz mono PCM16 per packet; 2 seconds of 24 kHz PCM16 output per packet.
const MAX_INPUT = 3200;
const MAX_OUTPUT = 96000;
const MAX_TRANSCRIPT = 4096;
const base64Bytes = (s: string): number => {
  if (!s || s.length > 128000 || s.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return -1;
  return (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
};

/** Single-use, explicit-start session. No audio/text/keys/errors are stored. */
export class VoiceSession {
  private stateValue: VoiceState = 'idle';
  private connection?: LiveConnection;
  private epoch = 0;
  private generationValue = 0;
  private ended = false;
  constructor(private readonly callbacks: VoiceCallbacks, private readonly adapter: LiveAdapter = (apiKey) => new GoogleGenAI({ apiKey })) {}
  get state(): VoiceState { return this.stateValue; }
  get generation(): number { return this.generationValue; }
  readonly model = VOICE_MODEL;

  private stateTo(state: VoiceState): void { this.stateValue = state; this.callbacks.onState?.(state); }
  private error(code: VoiceError['code'], message: string): void { this.callbacks.onError?.({ code, message }); }
  private fail(code: VoiceError['code'], message: string): void {
    this.error(code, message);
    this.close();
  }
  async connect(apiKey: string): Promise<void> {
    if (this.stateValue !== 'idle') throw new Error('VoiceSession is single-use');
    if (!apiKey || !apiKey.trim()) { this.fail('invalid_input', 'API key is required'); return; }
    this.stateTo('connecting');
    const epoch = ++this.epoch;
    try {
      const sdk = this.adapter(apiKey);
      const connection = await sdk.live.connect({
        model: VOICE_MODEL,
        config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {} },
        callbacks: {
          onmessage: (message) => { if (this.epoch === epoch && this.stateValue !== 'closed') this.receive(message); },
          onerror: () => { if (this.epoch === epoch && this.stateValue !== 'closed') this.fail('transport_error', 'Voice connection error'); },
          onclose: () => { if (this.epoch === epoch && this.stateValue !== 'closed') this.fail('disconnected', 'Voice connection closed'); },
        },
      });
      if (this.epoch !== epoch) { connection.close(); return; }
      this.connection = connection;
      this.stateTo('ready');
      this.callbacks.onReady?.();
    } catch {
      if (this.epoch === epoch) this.fail('connect_failed', 'Could not connect voice session');
    }
  }
  sendAudio(base64: string): void {
    if (this.stateValue !== 'ready' || !this.connection) return;
    const bytes = base64Bytes(base64);
    if (bytes < 2 || bytes > MAX_INPUT || bytes % 2 !== 0) { this.error('invalid_input', 'Invalid PCM16 input chunk'); return; }
    try {
      this.connection.sendRealtimeInput({ audio: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
      this.ended = false;
    } catch { this.fail('transport_error', 'Could not send audio'); }
  }
  /** Signals microphone stream end, NOT an end-of-turn or a local VAD decision. */
  endAudio(): void {
    if (this.stateValue !== 'ready' || !this.connection || this.ended) return;
    try { this.connection.sendRealtimeInput({ audioStreamEnd: true }); this.ended = true; }
    catch { this.fail('transport_error', 'Could not end audio stream'); }
  }
  close(): void {
    if (this.stateValue === 'closed') return;
    ++this.epoch;
    const connection = this.connection;
    this.connection = undefined;
    this.stateTo('closed');
    try { connection?.close(); } catch { /* never expose raw SDK errors */ }
  }
  private receive(message: Parameters<LiveParams['callbacks']['onmessage']>[0]): void {
    // Ignore any tool requests: this prototype does not advertise tools or a work bridge.
    const content = message.serverContent;
    if (!content) { if (message.goAway) this.fail('expiring', 'Voice session expiring; start a new session'); return; }
    if (content.interrupted) {
      ++this.generationValue;
      this.callbacks.onInterrupted?.(this.generationValue);
      if (this.stateValue === 'closed') return;
    }
    for (const part of content.modelTurn?.parts ?? []) {
      const audio = part.inlineData;
      if (!audio?.data || !audio.mimeType?.toLowerCase().startsWith('audio/pcm;rate=24000')) continue;
      const bytes = base64Bytes(audio.data);
      if (bytes < 2 || bytes > MAX_OUTPUT || bytes % 2) { this.fail('invalid_audio', 'Invalid output audio chunk'); return; }
      this.callbacks.onAudio?.(audio.data, this.generationValue);
      if (this.stateValue === 'closed') return;
    }
    for (const [text, callback] of [
      [content.inputTranscription?.text, this.callbacks.onInputTranscript],
      [content.outputTranscription?.text, (s: string) => this.callbacks.onOutputTranscript?.(s, this.generationValue)],
    ] as const) {
      if (text && text.length <= MAX_TRANSCRIPT) callback?.(text);
      if (this.stateValue === 'closed') return;
    }
    if (content.turnComplete) {
      this.callbacks.onTurnComplete?.(this.generationValue);
      if (this.stateValue === 'closed') return;
      ++this.generationValue;
    }
    if (message.goAway) this.fail('expiring', 'Voice session expiring; start a new session');
  }
}
