import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDefaultLiveCredentialService } from "../live/credentials";
import { liveLocalOnly } from "../live/status";
import { LiveLabAudio, type AudioCallbacks, type AudioSetupError } from "./audio";
import { VoiceSession } from "./session";
import { audioDiagnostic, audioLaunchDiagnostic } from "./diagnostics";
import { PlaybackScheduler } from "./playback";
import { VOICE_MODEL, type VoiceCallbacks } from "./types";

const ID = "die-live-lab";
const MAX_VISIBLE = 8;
const clean = (value: string) =>
  stripVTControlCharacters(value)
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))?/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ");

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
  let confirmation: number | undefined;
  let probe: AbortController | undefined;
  class Run {
    readonly id = ++sequence;
    readonly controller = new AbortController();
    voice?: LabVoice;
    audio?: LabAudio;
    state = "starting"; // lifecycle only: capture and pump run regardless of presentation
    speaking = false;
    generationFinished = false;
    heardQueue = false;
    private renderTimer?: ReturnType<typeof setTimeout>;
    private lastRender = 0;
    private lastStatus?: string;
    private lastWidget?: string;
    private readonly utterances: Record<"You" | "Voice", string> = { You: "", Voice: "" };
    pendingBytes = 0;
    inFlight = false;
    readonly playback: PlaybackScheduler;
    generation = 0;
    inputFrames = 0;
    outputBytes = 0;
    turns = 0;
    queuedMs = 0;
    readonly lines: string[] = [];
    constructor(readonly ctx: ExtensionContext) {
      this.playback = new PlaybackScheduler({
        send: (frame, epoch) =>
          this.audio ? this.audio.play(frame, epoch) : Promise.reject(new Error("Audio not ready")),
        flush: (epoch) => (this.audio ? this.audio.flush(epoch) : Promise.reject(new Error("Audio not ready"))),
        onError: () => this.fail("Playback failed or response exceeded the bounded audio budget"),
        onState: (s) => {
          if (!this.alive) return;
          this.pendingBytes = s.pendingBytes;
          this.inFlight = s.inFlight;
          this.drain();
          this.render();
        },
      });
    }
    get alive() {
      return current === this && !this.controller.signal.aborted;
    }
    render(immediate = false) {
      if (!this.alive) return;
      if (!immediate && Date.now() - this.lastRender < 100) {
        if (!this.renderTimer)
          this.renderTimer = setTimeout(
            () => {
              this.renderTimer = undefined;
              this.render(true);
            },
            100 - (Date.now() - this.lastRender),
          );
        return;
      }
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
        this.renderTimer = undefined;
      }
      this.lastRender = Date.now();
      const presentation = this.state === "running" ? (this.speaking ? "speaking" : "listening") : "connecting";
      const status = "Voice " + VOICE_MODEL + " · " + presentation;
      if (status !== this.lastStatus) {
        this.ctx.ui.setStatus(ID, status);
        this.lastStatus = status;
      }
      const lines = [...this.lines];
      for (const label of ["You", "Voice"] as const)
        if (this.utterances[label]) lines.push(label + ": " + this.utterances[label]);
      const visible = lines.slice(-MAX_VISIBLE);
      const widget = JSON.stringify(visible);
      if (widget !== this.lastWidget) {
        this.ctx.ui.setWidget(ID, visible.length ? visible : undefined);
        this.lastWidget = widget;
      }
    }
    transcript(label: "You" | "Voice", text: string, finished?: boolean) {
      if (!this.alive) return;
      const fragment = clean(text);
      const previous = this.utterances[label];
      // Transcript events are deltas. Keep boundaries legible without removing supplied spaces.
      const separator = "";
      this.utterances[label] = (previous + separator + fragment).slice(0, 180);
      if (finished) {
        if (this.utterances[label]) this.lines.push(label + ": " + this.utterances[label]);
        this.lines.splice(0, Math.max(0, this.lines.length - MAX_VISIBLE));
        this.utterances[label] = "";
      }
      this.render();
    }
    drain() {
      if (
        this.generationFinished &&
        this.pendingBytes === 0 &&
        !this.inFlight &&
        this.queuedMs === 0 &&
        this.heardQueue &&
        this.speaking
      ) {
        this.speaking = false;
        this.render(true);
      }
    }
    output(base64: string, epoch: number) {
      if (!this.alive || epoch !== this.generation) return;
      const pcm = Buffer.from(base64, "base64");
      this.outputBytes += pcm.length;
      if (pcm.length) {
        this.speaking = true;
        this.generationFinished = false;
      }
      this.playback.enqueue(pcm, epoch);
      this.render();
    }
    interrupt(epoch: number) {
      if (!this.alive || epoch <= this.generation) return;
      this.generation = epoch;
      this.pendingBytes = 0;
      this.queuedMs = 0;
      this.speaking = false;
      this.generationFinished = false;
      this.heardQueue = false;
      this.playback.interrupt(epoch);
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
      this.playback.close();
      this.pendingBytes = 0;
      this.lines.length = 0;
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
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
              if (this.alive && this.state === "running") {
                this.inputFrames++;
                this.voice?.sendAudio(pcm.toString("base64"));
                this.render();
              }
            },
            played: (ms) => {
              if (this.alive) {
                this.queuedMs = ms;
                if (ms > 0) this.heardQueue = true;
                this.playback.nativeQueued(ms);
                this.drain();
                this.render();
              }
            },
            error: (code, _message, detail) => this.fail(audioDiagnostic(code, detail)),
            closed: () => {
              if (this.alive) this.fail(audioDiagnostic("helper_failure"));
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
              this.generationFinished = true;
              this.playback.turnComplete(this.generation);
              this.drain();
              this.render();
            }
          },
          onInputTranscript: (t) => this.transcript("You", t.text, t.finished),
          onOutputTranscript: (t) => this.transcript("Voice", t.text, t.finished),
          onError: (e) => this.fail("Provider " + e.code),
        });
        await this.voice.connect(key);
        if (!this.alive) return;
        if (this.voice.state !== "ready") {
          this.fail("Provider did not accept session");
          return;
        }
        this.state = "running"; // capture may arrive synchronously inside audio.start()
        await this.audio.start();
        if (!this.alive) return;
        this.playback.start();
        if (!this.alive) return;
        this.render();
      } catch {
        if (this.alive)
          this.fail(
            this.audio
              ? "Voice or audio startup failed [startup]; try /live-lab mic-check without a provider and check provider auth separately"
              : audioLaunchDiagnostic(),
          );
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
          "Check mic/speakers (no provider; explicit consent)",
        ]);
        action =
          choice === "Status"
            ? "status"
            : choice === "Start paid Google voice + microphone"
              ? "start"
              : choice === "Stop voice lab"
                ? "stop"
                : choice === "Check mic/speakers (no provider; explicit consent)"
                  ? "mic-check"
                  : "";
      }
      if (action === "status") {
        ctx.ui.notify(
          current
            ? "Voice lab " +
                (current.state === "running" ? (current.speaking ? "speaking" : "listening") : "connecting") +
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
      } else if (action === "mic-check") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Mic check requires a local interactive terminal.", "warning");
          return;
        }
        if (current || confirmation !== undefined || probe) {
          ctx.ui.notify("Voice lab is busy; stop it first.", "info");
          return;
        }
        const owner = ++sequence;
        confirmation = owner;
        let consent = false;
        try {
          consent = await ctx.ui.confirm(
            "Local microphone and speaker check",
            "Open microphone and speakers briefly? No Google key, network, playback or agent tools. Captured audio is discarded, not saved or sent. macOS may request microphone permission.",
          );
        } catch {
          /* dialog closed */
        }
        if (confirmation !== owner || owner !== sequence) return;
        confirmation = undefined;
        if (!consent) return;
        const controller = new AbortController();
        probe = controller;
        let audio: LabAudio | undefined;
        let code: string | undefined;
        let setup: AudioSetupError | undefined;
        try {
          audio = await deps.audio(
            {
              error: (value, _message, detail) => {
                code = value;
                setup = detail;
              },
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          await audio.start();
          if (!controller.signal.aborted)
            ctx.ui.notify(
              code
                ? "Mic check: " + audioDiagnostic(code, setup)
                : "Audio route ready [ready]. No provider or recording saved; this does not prove sound quality.",
              code ? "warning" : "info",
            );
        } catch {
          if (!controller.signal.aborted)
            ctx.ui.notify(
              "Mic check: " +
                (code ? audioDiagnostic(code, setup) : audio ? audioDiagnostic("helper_failure") : audioLaunchDiagnostic()),
              "warning",
            );
        } finally {
          if (audio) {
            await audio.stop().catch(() => {});
            audio.close();
          }
          if (probe === controller) probe = undefined;
        }
      } else if (action === "stop") {
        probe?.abort();
        sequence++;
        confirmation = undefined;
        current?.stop();
        ctx.ui.notify("Voice lab off; agent work unchanged.", "info");
      } else if (action === "start") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Voice lab requires local interactive macOS or Linux CLI.", "warning");
          return;
        }
        if (current || confirmation !== undefined || probe) {
          ctx.ui.notify("Voice lab already starting or running.", "info");
          return;
        }
        const owner = ++sequence;
        confirmation = owner;
        let consent: boolean;
        try {
          consent = await ctx.ui.confirm(
            "Paid Google voice + microphone",
            "Start a paid Google Gemini voice session and open the microphone/speakers? Voice-only: NO agent tools or bridge. Transcripts are temporary on screen, not saved to chat. /live-lab stop closes voice only.",
          );
        } catch {
          if (confirmation === owner) confirmation = undefined;
          return;
        }
        if (confirmation !== owner || owner !== sequence) return;
        confirmation = undefined;
        if (!consent || current) return;
        const run = new Run(ctx);
        current = run;
        run.render(true);
        await run.start();
      } else if (action) ctx.ui.notify("Usage: /live-lab [start|stop|status|mic-check]", "info");
    },
  });
  pi.on("session_shutdown", () => {
    sequence++;
    confirmation = undefined;
    probe?.abort();
    current?.stop();
  });
  pi.on("session_start", () => {
    sequence++;
    confirmation = undefined;
    probe?.abort();
    current?.stop();
  });
}
