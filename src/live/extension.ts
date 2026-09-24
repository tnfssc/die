import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDefaultLiveCredentialService, type LiveCredentialService } from "./credentials";
import { liveLocalOnly } from "./status";
import { runLiveSetup } from "./setup";
import { LiveAudio, type AudioCallbacks, type AudioSetupError } from "./audio";
import { getLiveHost } from "./host-access";
import { boundedHostContext, createOrchestration, type VoiceHost } from "./orchestration";
import { VoiceSession } from "./session";
import { audioDiagnostic, audioLaunchDiagnostic } from "./diagnostics";
import { PlaybackScheduler } from "./playback";
import { VOICE_MODEL, type VoiceCallbacks, type VoiceOrchestration } from "./types";

const ID = "die-live";
const MAX_VISIBLE = 8;
const clean = (value: string) =>
  stripVTControlCharacters(value)
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))?/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ");

export interface LiveDependencies {
  local(mode: string): boolean;
  /** Local-only bounded test; result is a sanitized human-readable summary, never PCM. */
  speakerCheck(args: { audio: LiveDependencies["audio"]; signal: AbortSignal }): Promise<string>;
  key(signal: AbortSignal): Promise<string>;
  credentials(signal: AbortSignal): Promise<LiveCredentialService>;
  voice(
    callbacks: VoiceCallbacks,
    orchestration?: VoiceOrchestration,
  ): Pick<VoiceSession, "connect" | "sendAudio" | "close" | "state" | "generation"> &
    Partial<Pick<VoiceSession, "sendContext" | "diagnostics">>;
  host(pi: ExtensionAPI, ctx: ExtensionContext): VoiceHost | undefined;
  audio(
    callbacks: AudioCallbacks,
    signal: AbortSignal,
  ): Promise<Pick<LiveAudio, "start" | "play" | "flush" | "stop" | "close" | "diagnostics">>;
}
const defaults: LiveDependencies = {
  speakerCheck: async (args) => {
    const { runSpeakerCheck } = await import("./speaker-check");
    const { speakerCheckSummary } = await import("./speaker-summary");
    return speakerCheckSummary(await runSpeakerCheck(args.audio, args.signal));
  },
  local: (mode) =>
    (process.platform === "darwin" || process.platform === "linux") &&
    liveLocalOnly(mode, process.env, Boolean(process.stdin.isTTY && process.stdout.isTTY)),
  credentials: createDefaultLiveCredentialService,
  key: async (signal) => (await createDefaultLiveCredentialService(signal)).loadKey(signal),
  voice: (callbacks, orchestration) => new VoiceSession(callbacks, undefined, orchestration),
  host: getLiveHost,
  audio: (callbacks, signal) => LiveAudio.launch({ callbacks, signal }),
};

type NativeAudio = Awaited<ReturnType<LiveDependencies["audio"]>>;
type NativeVoice = ReturnType<LiveDependencies["voice"]>;

/** Native full-duplex voice; configured agent work has an independent lifecycle. */
export default function liveExtension(pi: ExtensionAPI, injected: Partial<LiveDependencies> = {}): void {
  const deps = { ...defaults, ...injected };
  let current: Run | undefined;
  let sequence = 0;
  let confirmation: number | undefined;
  let entry: AbortController | undefined;
  let probe: AbortController | undefined;
  let speakerProbe: AbortController | undefined;
  class Run {
    readonly id = ++sequence;
    readonly controller = new AbortController();
    voice?: NativeVoice;
    orchestration?: VoiceOrchestration;
    private inputUtterance = "";
    host?: VoiceHost;
    unsubscribeHost?: () => void;
    audio?: NativeAudio;
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
    completedInputTranscripts = 0;
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
      const status = "Live " + presentation;
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
      this.orchestration?.beginUserTurn?.();
      this.inputUtterance = "";
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
      this.ctx.ui.notify("Live stopped: " + message + ". No agent work was cancelled.", "warning");
    }
    stop() {
      if (current !== this) return;
      current = undefined;
      this.orchestration?.beginUserTurn?.();
      this.inputUtterance = "";
      this.controller.abort();
      this.unsubscribeHost?.();
      this.unsubscribeHost = undefined;
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
    async start(key: string) {
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
        this.host = deps.host(pi, this.ctx);
        this.orchestration = this.host ? createOrchestration(this.host) : undefined;
        this.voice = deps.voice(
          {
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
            onInputTranscript: (t) => {
              if (!this.alive) return;
              if (!this.inputUtterance && t.text) this.orchestration?.beginUserTurn?.();
              this.inputUtterance = (this.inputUtterance + t.text).slice(0, 4001);
              if (t.finished) {
                this.completedInputTranscripts++;
                this.orchestration?.userTranscript(this.inputUtterance);
                this.inputUtterance = "";
              }
              this.transcript("You", t.text, t.finished);
            },
            onOutputTranscript: (t) => this.transcript("Voice", t.text, t.finished),
            onError: (e) => this.fail("Provider " + e.code),
          },
          this.orchestration,
        );
        await this.voice.connect(key);
        if (!this.alive) return;
        if (this.voice.state !== "ready") {
          this.fail("Provider did not accept session");
          return;
        }
        if (this.host) {
          this.voice.sendContext?.(boundedHostContext(this.host.context()));
          this.unsubscribeHost = this.host.subscribe((update) => {
            if (!this.alive) return;
            this.voice?.sendContext?.(boundedHostContext(update));
            // Only actual host events. Never infer progress from time or voice turns.
            const event = clean(JSON.stringify(update)).slice(0, 180);
            this.lines.push("Agent event: " + event);
            this.lines.splice(0, Math.max(0, this.lines.length - MAX_VISIBLE));
            this.render();
          });
        } else {
          this.ctx.ui.notify(
            "Voice connected without host orchestration: current-session job authority is unavailable.",
            "warning",
          );
        }
        if (!this.alive) return;
        this.state = "running"; // capture may arrive synchronously inside audio.start()
        await this.audio.start();
        if (!this.alive) return;
        this.playback.start();
        if (!this.alive) return;
        this.render(true);
      } catch {
        if (this.alive)
          this.fail(
            this.audio
              ? "Voice or audio startup failed [startup]; try /live mic-check without a provider and check provider auth separately"
              : audioLaunchDiagnostic(),
          );
      }
    }
  }
  pi.registerCommand("live", {
    description: "Toggle voice with Google Gemini (paid; microphone and speakers)",
    getArgumentCompletions: (prefix) => {
      const matches = ["start", "stop", "setup", "status", "mic-check", "speaker-check"].filter((value) =>
        value.startsWith(prefix),
      );
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const active = current || entry || confirmation !== undefined || probe || speakerProbe;
      const action = args.trim() || (active ? "stop" : "start");
      if (action === "status") {
        ctx.ui.notify(
          current
            ? "Live " +
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
                " · provider interruptions " +
                (current.voice?.diagnostics?.serverInterruptions ?? "unknown") +
                " · agent " +
                (current.host ? "connected" : "unavailable") +
                " · tools configured " +
                (current.orchestration?.tools.length ?? 0) +
                " · completed input transcripts " +
                current.completedInputTranscripts +
                " · native VP " +
                (current.audio?.diagnostics.ready
                  ? (current.audio.diagnostics.ready.voiceProcessingEnabled ? "enabled" : "disabled") +
                    "/" +
                    (current.audio.diagnostics.ready.voiceProcessingBypassed ? "bypassed" : "unbypassed") +
                    " (configuration only, AEC unmeasured)"
                  : "unknown") +
                ". Agent work is independent of voice."
            : speakerProbe
              ? "Local speaker check running; provider not connected. /live stop cancels the check; agent work is unchanged."
              : probe
                ? "Local mic check running; provider not connected. Agent work is unchanged."
                : entry
                  ? "Live setup."
                  : "Live off.",
          "info",
        );
      } else if (action === "mic-check") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Mic check requires a local interactive terminal.", "warning");
          return;
        }
        if (current || entry || confirmation !== undefined || probe || speakerProbe) {
          ctx.ui.notify("Live is busy; stop it first.", "info");
          return;
        }
        const owner = ++sequence;
        confirmation = owner;
        let consent = false;
        try {
          consent = await ctx.ui.confirm(
            "Mic check",
            "Open microphone and speakers briefly? No playback, provider or agent tools. Audio is discarded, not saved or sent. macOS may ask for microphone access.",
          );
        } catch {
          /* dialog closed */
        }
        if (confirmation !== owner || owner !== sequence) return;
        confirmation = undefined;
        if (!consent) return;
        const controller = new AbortController();
        probe = controller;
        let audio: NativeAudio | undefined;
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
                (code
                  ? audioDiagnostic(code, setup)
                  : audio
                    ? audioDiagnostic("helper_failure")
                    : audioLaunchDiagnostic()),
              "warning",
            );
        } finally {
          if (audio) {
            await audio.stop().catch(() => {});
            audio.close();
          }
          if (probe === controller) probe = undefined;
        }
      } else if (action === "speaker-check") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Speaker check requires a local interactive terminal.", "warning");
          return;
        }
        if (current || entry || confirmation !== undefined || probe || speakerProbe) {
          ctx.ui.notify("Live is busy; stop it first.", "info");
          return;
        }
        const owner = ++sequence;
        confirmation = owner;
        let consent = false;
        try {
          consent = await ctx.ui.confirm(
            "Speaker check",
            "Play a quiet test sound and briefly open the microphone? Lower speaker volume and stay quiet. Local only: no provider or agent tools. Audio stays in memory and is discarded.",
          );
        } catch {
          /* dialog closed */
        }
        if (confirmation !== owner || owner !== sequence) return;
        confirmation = undefined;
        if (!consent) return;
        const controller = new AbortController();
        speakerProbe = controller;
        try {
          const summary = await deps.speakerCheck({ audio: deps.audio, signal: controller.signal });
          if (!controller.signal.aborted && speakerProbe === controller)
            ctx.ui.notify(
              "Speaker check (local; provider not connected): " +
                clean(summary).slice(0, 1800) +
                " This test cannot prove barge-in or AEC quality.",
              "info",
            );
        } catch {
          if (!controller.signal.aborted && speakerProbe === controller)
            ctx.ui.notify(
              "Speaker check failed; provider not connected. Check microphone access and the selected devices, or try /live mic-check.",
              "warning",
            );
        } finally {
          if (speakerProbe === controller) speakerProbe = undefined;
        }
      } else if (action === "stop") {
        probe?.abort();
        speakerProbe?.abort();
        sequence++;
        entry?.abort();
        entry = undefined;
        confirmation = undefined;
        current?.stop();
        ctx.ui.notify("Live off.", "info");
      } else if (action === "start" || action === "setup") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Live requires a local interactive macOS or Linux terminal.", "warning");
          return;
        }
        if (current || entry || confirmation !== undefined || probe || speakerProbe) {
          ctx.ui.notify("Live is already active. Use /live stop first.", "info");
          return;
        }
        const controller = new AbortController();
        entry = controller;
        const owner = ++sequence;
        const alive = () => entry === controller && owner === sequence && !controller.signal.aborted;
        try {
          let key: string | undefined;
          if (action === "start") {
            try {
              key = await deps.key(controller.signal);
            } catch {
              // Missing or incompatible auth gets focused setup, never a raw provider error.
            }
          }
          if (!alive()) return;
          if (!key) {
            const credentials = await deps.credentials(controller.signal);
            if (!alive()) return;
            const start = await runLiveSetup(ctx.ui, credentials, controller.signal);
            if (!alive() || !start) return;
            key = await credentials.loadKey(controller.signal);
          }
          if (!alive()) return;
          entry = undefined;
          const run = new Run(ctx);
          current = run;
          run.render(true);
          await run.start(key);
        } catch {
          if (alive()) ctx.ui.notify("Could not read Google credentials. Try /live setup.", "warning");
        } finally {
          if (entry === controller) entry = undefined;
        }
      } else if (action) ctx.ui.notify("Usage: /live [start|setup|stop|status|mic-check|speaker-check]", "info");
    },
  });
  pi.on("session_shutdown", () => {
    sequence++;
    entry?.abort();
    entry = undefined;
    confirmation = undefined;
    probe?.abort();
    speakerProbe?.abort();
    current?.stop();
  });
  pi.on("session_start", () => {
    sequence++;
    entry?.abort();
    entry = undefined;
    confirmation = undefined;
    probe?.abort();
    speakerProbe?.abort();
    current?.stop();
  });
}
