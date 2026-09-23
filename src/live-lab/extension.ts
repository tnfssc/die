import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDefaultLiveCredentialService } from "../live/credentials";
import { liveLocalOnly } from "../live/status";
import { LiveLabAudio, type AudioCallbacks } from "./audio";
import { VoiceSession } from "./session";
import { VOICE_MODEL, type VoiceCallbacks } from "./types";

const ID = "die-live-lab";
const FRAME_BYTES = 9600; // 200ms, mono 24k PCM16; helper's MAX_PLAY
const MAX_PENDING_BYTES = 96000; // 2s SDK packet; never silently drop speech
const MAX_VISIBLE = 8;
const clean = (value: string) =>
  value
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 180);

export interface LabDependencies {
  local(mode: string): boolean;
  key(signal: AbortSignal): Promise<string>;
  voice(callbacks: VoiceCallbacks): Pick<VoiceSession, "connect" | "sendAudio" | "close" | "state" | "generation">;
  audio(
    callbacks: AudioCallbacks,
    signal: AbortSignal,
  ): Promise<Pick<LiveLabAudio, "start" | "play" | "flush" | "stop" | "close" | "diagnostics">>;
}
const defaults: LabDependencies = {
  local: (mode) =>
    (process.platform === "darwin" || process.platform === "linux") &&
    liveLocalOnly(mode, process.env, Boolean(process.stdin.isTTY && process.stdout.isTTY)),
  key: async (signal) => (await createDefaultLiveCredentialService(signal)).loadKey(signal),
  voice: (callbacks) => new VoiceSession(callbacks),
  audio: (callbacks, signal) => LiveLabAudio.launch({ callbacks, signal }),
};

type LabAudio = Awaited<ReturnType<LabDependencies["audio"]>>;
type LabVoice = ReturnType<LabDependencies["voice"]>;

/** Separate from /live: no agent bridge, tools, messages, or agent cancellation. */
export default function liveLabExtension(pi: ExtensionAPI, injected: Partial<LabDependencies> = {}): void {
  const deps = { ...defaults, ...injected };
  let current: Run | undefined;
  let sequence = 0;
  class Run {
    readonly id = ++sequence;
    readonly controller = new AbortController();
    voice?: LabVoice;
    audio?: LabAudio;
    state = "starting";
    pending: Buffer[] = [];
    pendingBytes = 0;
    pumping = false;
    flushing: Promise<void> = Promise.resolve();
    generation = 0;
    inputFrames = 0;
    outputBytes = 0;
    turns = 0;
    queuedMs = 0;
    readonly lines: string[] = [];
    constructor(readonly ctx: ExtensionContext) {}
    get alive() {
      return current === this && !this.controller.signal.aborted;
    }
    render() {
      if (!this.alive) return;
      this.ctx.ui.setStatus(
        ID,
        "voice lab " +
          this.state +
          " · " +
          VOICE_MODEL +
          " · input " +
          this.inputFrames +
          " frames · output " +
          Math.floor(this.outputBytes / 48) +
          "ms · turns " +
          this.turns +
          " · queued " +
          Math.round(this.queuedMs) +
          "ms · pending " +
          Math.floor(this.pendingBytes / 48) +
          "ms (no agent tools)",
      );
      this.ctx.ui.setWidget(ID, this.lines.length ? [...this.lines] : undefined);
    }
    transcript(label: string, text: string) {
      if (!this.alive || !text) return;
      this.lines.push(label + ": " + clean(text));
      if (this.lines.length > MAX_VISIBLE) this.lines.splice(0, this.lines.length - MAX_VISIBLE);
      this.render();
    }
    async pump() {
      if (this.pumping) return;
      this.pumping = true;
      try {
        while (this.alive && this.state === "listening" && this.audio && this.pending.length) {
          const frame = this.pending.shift()!;
          this.pendingBytes -= frame.length;
          const gen = this.generation;
          await this.flushing;
          if (!this.alive || gen !== this.generation) continue;
          try {
            await this.audio.play(frame, gen);
          } catch {
            if (this.alive && gen === this.generation) throw new Error("Playback failed");
          }
        }
      } catch {
        if (this.alive) this.fail("Playback helper failed");
      } finally {
        this.pumping = false;
        if (this.alive && this.state === "listening" && this.pending.length) void this.pump();
      }
    }
    output(base64: string, epoch: number) {
      if (!this.alive || epoch !== this.generation) return;
      // SDK checked PCM16/base64 and bounded each turn. Split without collecting entire turn.
      const pcm = Buffer.from(base64, "base64");
      if (this.pendingBytes + pcm.length > MAX_PENDING_BYTES || this.queuedMs > 1200) {
        this.fail("Playback backlog exceeded 2 seconds; voice stopped rather than dropping speech");
        return;
      }
      this.outputBytes += pcm.length;
      for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
        const frame = pcm.subarray(i, i + FRAME_BYTES);
        this.pending.push(frame);
        this.pendingBytes += frame.length;
      }
      void this.pump();
      this.render();
    }
    interrupt(epoch: number) {
      if (!this.alive) return;
      this.generation = epoch;
      this.pending = [];
      this.pendingBytes = 0;
      if (this.state === "listening")
        this.flushing = this.audio!.flush(epoch).catch(() => {
          if (this.alive) this.fail("Playback flush failed");
        });
      this.render();
    }
    fail(message: string) {
      if (!this.alive) return;
      this.stop();
      this.ctx.ui.notify("Voice lab stopped: " + message + ". No agent work was cancelled.", "warning");
    }
    stop() {
      if (current !== this) return;
      current = undefined;
      this.controller.abort();
      this.state = "off";
      this.pending = [];
      this.pendingBytes = 0;
      this.lines.length = 0;
      this.voice?.close();
      const audio = this.audio;
      this.audio = undefined;
      if (audio) {
        void audio
          .stop()
          .catch(() => {})
          .finally(() => audio.close());
      }
      this.ctx.ui.setStatus(ID, undefined);
      this.ctx.ui.setWidget(ID, undefined);
    }
    async start() {
      try {
        // Hello does not open devices. Provider setup must succeed BEFORE audio.start().
        this.audio = await deps.audio(
          {
            capture: (pcm) => {
              if (this.alive && this.state === "listening") {
                this.inputFrames++;
                this.voice?.sendAudio(pcm.toString("base64"));
                this.render();
              }
            },
            played: (ms) => {
              if (this.alive) {
                this.queuedMs = ms;
                this.render();
              }
            },
            error: () => this.fail("Audio helper error"),
            closed: () => {
              if (this.alive) this.fail("Audio helper closed");
            },
          },
          this.controller.signal,
        );
        if (!this.alive) {
          this.audio.close();
          return;
        }
        const key = await deps.key(this.controller.signal);
        if (!this.alive) return;
        this.voice = deps.voice({
          onAudio: (pcm, epoch) => this.output(pcm, epoch),
          onInterrupted: (epoch) => this.interrupt(epoch),
          onTurnComplete: () => {
            if (this.alive) {
              this.turns++;
              this.render();
            }
          },
          onInputTranscript: (t) => this.transcript("You", t.text),
          onOutputTranscript: (t) => this.transcript("Voice", t.text),
          onError: (e) => this.fail("Provider " + e.code),
        });
        await this.voice.connect(key);
        if (!this.alive) return;
        if (this.voice.state !== "ready") {
          this.fail("Provider did not accept session");
          return;
        }
        await this.audio.start();
        if (!this.alive) return;
        this.state = "listening";
        if (this.generation) await this.audio.flush(this.generation);
        if (!this.alive) return;
        void this.pump();
        this.render();
      } catch {
        if (this.alive) this.fail("Startup failed; check Google API-key auth and the local audio helper");
      }
    }
  }
  pi.registerCommand("live-lab", {
    description: "Opt-in voice-only Gemini lab (no agent tools): start, stop, status",
    handler: async (args, ctx) => {
      let action = args.trim();
      if (!action) {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Voice lab requires local interactive macOS or Linux CLI.", "warning");
          return;
        }
        const choice = await ctx.ui.select("Voice-only lab (no agent tools)", [
          "Status",
          "Start paid Google voice + microphone",
          "Stop voice lab",
        ]);
        action =
          choice === "Status"
            ? "status"
            : choice === "Start paid Google voice + microphone"
              ? "start"
              : choice === "Stop voice lab"
                ? "stop"
                : "";
      }
      if (action === "status") {
        ctx.ui.notify(
          current
            ? "Voice lab " +
                current.state +
                " · " +
                VOICE_MODEL +
                " · input " +
                current.inputFrames +
                " frames · output " +
                Math.floor(current.outputBytes / 48) +
                "ms · queued " +
                Math.round(current.queuedMs) +
                "ms · turns " +
                current.turns +
                ". No agent bridge or tools."
            : "Voice lab off. No key, network, microphone or helper opened. No agent bridge or tools.",
          "info",
        );
      } else if (action === "stop") {
        current?.stop();
        ctx.ui.notify("Voice lab off; agent work unchanged.", "info");
      } else if (action === "start") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Voice lab requires local interactive macOS or Linux CLI.", "warning");
          return;
        }
        if (current) {
          ctx.ui.notify("Voice lab already " + current.state + ".", "info");
          return;
        }
        const consent = await ctx.ui.confirm(
          "Paid Google voice + microphone",
          "Start a paid Google Gemini voice session and open the microphone/speakers? Voice-only: NO agent tools or bridge. Transcripts are temporary on screen, not saved to chat. /live-lab stop closes voice only.",
        );
        if (!consent || current) return;
        const run = new Run(ctx);
        current = run;
        run.render();
        await run.start();
      } else if (action) ctx.ui.notify("Usage: /live-lab [start|stop|status]", "info");
    },
  });
  pi.on("session_shutdown", () => {
    current?.stop();
  });
}
