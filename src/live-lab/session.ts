import { GoogleGenAI, Modality } from "@google/genai";
import {
  VOICE_MODEL,
  type LiveAdapter,
  type LiveConnection,
  type LiveParams,
  type VoiceCallbacks,
  type VoiceError,
  type VoiceState,
  type VoiceTranscript,
} from "./types.js";

const MAX_INPUT = 3200; // 100 ms PCM16 mono 16 kHz
const MAX_OUTPUT = 96000; // 2 seconds PCM16 mono 24 kHz per packet
const MAX_TURN_OUTPUT = 24 * MAX_OUTPUT;
const MAX_TRANSCRIPT = 4096;
const CONNECT_TIMEOUT_MS = 15000;
const base64Bytes = (s: string): number => {
  if (!s || s.length > 128000 || s.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return -1;
  return (s.length / 4) * 3 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
};
const pcm24 = (mime: string): boolean => /^audio\/pcm\s*;\s*rate=24000$/i.test(mime.trim());
type Message = Parameters<LiveParams["callbacks"]["onmessage"]>[0];

/** Single-use, explicit-start voice-only session. Never retains audio/text/keys. */
export class VoiceSession {
  private stateValue: VoiceState = "idle";
  private connection?: LiveConnection;
  private epoch = 0;
  private playbackEpochValue = 0;
  private turnValue = 0;
  private turnBytes = 0;
  private inputChars = 0;
  private outputChars = 0;
  private ended = false;
  private cancelConnect?: () => void;
  constructor(
    private readonly callbacks: VoiceCallbacks,
    private readonly adapter: LiveAdapter = (apiKey) => new GoogleGenAI({ apiKey }),
  ) {}
  get state(): VoiceState {
    return this.stateValue;
  }
  /** Playback cancellation epoch (not turn identity). */
  get generation(): number {
    return this.playbackEpochValue;
  }
  get turn(): number {
    return this.turnValue;
  }
  readonly model = VOICE_MODEL;

  private emit(fn: () => void): void {
    try {
      fn();
    } catch {
      this.fail("transport_error", "Voice callback failed");
    }
  }
  private stateTo(state: VoiceState): void {
    this.stateValue = state;
    try {
      this.callbacks.onState?.(state);
    } catch {
      /* user callback must not escape into SDK */
    }
  }
  private error(code: VoiceError["code"], message: string): void {
    try {
      this.callbacks.onError?.({ code, message });
    } catch {
      /* user callback must not escape into SDK */
    }
  }
  private fail(code: VoiceError["code"], message: string): void {
    if (this.stateValue === "closed") return;
    this.close();
    this.error(code, message);
  }
  async connect(apiKey: string): Promise<void> {
    if (this.stateValue !== "idle") throw new Error("VoiceSession is single-use");
    if (!apiKey?.trim()) {
      this.fail("invalid_input", "API key is required");
      return;
    }
    const epoch = ++this.epoch;
    this.stateTo("connecting");
    if (this.epoch !== epoch) return;
    // SDK 2.24.0 connect resolves only AFTER setupComplete (dist/index.mjs Live.connect).
    // It can hang if the socket never opens or setup never arrives; race a bounded local cancellation.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = new Promise<null>((resolve) => {
      this.cancelConnect = () => resolve(null);
      timer = setTimeout(() => {
        this.fail("connect_failed", "Voice connection timed out");
        resolve(null);
      }, CONNECT_TIMEOUT_MS);
    });
    let connecting: Promise<LiveConnection>;
    try {
      connecting = this.adapter(apiKey).live.connect({
        model: VOICE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: { automaticActivityDetection: { disabled: false } },
        },
        callbacks: {
          onmessage: (message) => {
            if (this.epoch === epoch && this.stateValue === "ready") this.emit(() => this.receive(message));
          },
          onerror: () => {
            if (this.epoch === epoch) this.fail("transport_error", "Voice connection error");
          },
          onclose: () => {
            if (this.epoch === epoch) this.fail("disconnected", "Voice connection closed");
          },
        },
      });
    } catch {
      if (this.epoch === epoch) this.fail("connect_failed", "Could not connect voice session");
      if (timer) clearTimeout(timer);
      return;
    }
    // The SDK's pending connect is not abortable: close any late result and consume late rejection.
    void connecting.then(
      (connection) => {
        if (this.epoch !== epoch) {
          try {
            connection.close();
          } catch {
            /* SDK */
          }
        }
      },
      () => {},
    );
    try {
      const connection = await Promise.race([connecting, cancelled]);
      if (!connection || this.epoch !== epoch) return;
      this.connection = connection;
      this.stateTo("ready");
      if (this.epoch === epoch) this.emit(() => this.callbacks.onReady?.());
    } catch {
      if (this.epoch === epoch) this.fail("connect_failed", "Could not connect voice session");
    } finally {
      if (timer) clearTimeout(timer);
      this.cancelConnect = undefined;
    }
  }
  sendAudio(base64: string): void {
    if (this.stateValue !== "ready" || !this.connection) return;
    const bytes = base64Bytes(base64);
    if (bytes < 2 || bytes > MAX_INPUT || bytes % 2) {
      this.error("invalid_input", "Invalid PCM16 input chunk");
      return;
    }
    try {
      this.connection.sendRealtimeInput({ audio: { data: base64, mimeType: "audio/pcm;rate=16000" } });
      if (this.stateValue === "ready") this.ended = false;
    } catch {
      this.fail("transport_error", "Could not send audio");
    }
  }
  /** Signals microphone stream end, not a local VAD or end-of-turn decision. */
  endAudio(): void {
    if (this.stateValue !== "ready" || !this.connection || this.ended) return;
    this.ended = true;
    try {
      this.connection.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      this.fail("transport_error", "Could not end audio stream");
    }
  }
  close(): void {
    if (this.stateValue === "closed") return;
    ++this.epoch;
    this.cancelConnect?.();
    const connection = this.connection;
    this.connection = undefined;
    this.stateTo("closed");
    try {
      connection?.close();
    } catch {
      /* SDK */
    }
  }
  private transcript(
    value: { text?: string; finished?: boolean; languageCode?: string; speakerLabel?: string } | undefined,
    input: boolean,
  ): VoiceTranscript | undefined {
    if (!value) return;
    const text = value.text ?? "";
    const total = input ? this.inputChars : this.outputChars;
    if (text.length > MAX_TRANSCRIPT || total + text.length > MAX_TRANSCRIPT) {
      this.fail("transcript_limit", "Voice transcription limit exceeded");
      return;
    }
    if (input) this.inputChars += text.length;
    else this.outputChars += text.length;
    return {
      text,
      ...(value.finished === undefined ? {} : { finished: value.finished }),
      ...(value.languageCode ? { languageCode: value.languageCode } : {}),
      ...(value.speakerLabel ? { speakerLabel: value.speakerLabel } : {}),
    };
  }
  private receive(message: Message): void {
    // No tool requests are advertised or executed.
    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        ++this.playbackEpochValue;
        this.turnBytes = 0;
        this.emit(() => this.callbacks.onInterrupted?.(this.playbackEpochValue));
        if (this.stateValue !== "ready") return;
      }
      // Audio in the SAME interrupted message belongs to the cancelled turn, never enqueue it.
      if (!content.interrupted)
        for (const part of content.modelTurn?.parts ?? []) {
          const audio = part.inlineData;
          if (!audio?.data || !audio.mimeType?.toLowerCase().startsWith("audio/pcm")) continue;
          const bytes = base64Bytes(audio.data);
          if (!pcm24(audio.mimeType) || bytes < 2 || bytes > MAX_OUTPUT || bytes % 2) {
            this.fail("invalid_audio", "Invalid output audio chunk");
            return;
          }
          this.turnBytes += bytes;
          if (this.turnBytes > MAX_TURN_OUTPUT) {
            this.fail("invalid_audio", "Voice turn audio limit exceeded");
            return;
          }
          this.emit(() => this.callbacks.onAudio?.(audio.data!, this.playbackEpochValue));
          if (this.stateValue !== "ready") return;
        }
      for (const [value, input] of [
        [content.inputTranscription, true],
        [content.outputTranscription, false],
      ] as const) {
        const transcript = this.transcript(value, input);
        if (this.stateValue !== "ready") return;
        if (transcript)
          this.emit(() =>
            input
              ? this.callbacks.onInputTranscript?.(transcript)
              : this.callbacks.onOutputTranscript?.(transcript, this.playbackEpochValue),
          );
        if (this.stateValue !== "ready") return;
      }
      if (content.turnComplete) {
        this.emit(() => this.callbacks.onTurnComplete?.(this.turnValue));
        if (this.stateValue !== "ready") return;
        ++this.turnValue;
        this.turnBytes = this.inputChars = this.outputChars = 0;
      }
    }
    if (message.goAway) this.fail("expiring", "Voice session expiring; start a new session");
  }
}
