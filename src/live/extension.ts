import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDefaultLiveCredentialService, type LiveCredentialService, type LiveProviderId } from "./credentials";
import { LIVE_PROVIDERS } from "./providers";
import { OpenAIVoiceSession as OpenAIRealtimeSession } from "./openai-session";
import { liveLocalOnly } from "./status";
import { runLiveSetup } from "./setup";
import { LiveAudio, type AudioCallbacks, type AudioSetupError } from "./audio";
import { getLiveHost } from "./host-access";
import { boundedHostContext, createOrchestration, type VoiceHost } from "./orchestration";
import { VoiceSession } from "./session";
import { audioDiagnostic, audioLaunchDiagnostic } from "./diagnostics";
import { PlaybackScheduler } from "./playback";
import { LiveWaveform } from "./waveform";
import { TranscriptLog, VOICE_ENTRY } from "./transcript";
import { type VoiceCallbacks, type VoiceOrchestration, type VoiceProvider } from "./types";

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
  key(signal: AbortSignal, provider?: LiveProviderId): Promise<string>;
  credentials(signal: AbortSignal, provider?: LiveProviderId): Promise<LiveCredentialService>;
  voice(
    callbacks: VoiceCallbacks,
    orchestration?: VoiceOrchestration,
    provider?: LiveProviderId,
  ): Pick<VoiceProvider, "connect" | "sendAudio" | "close" | "state" | "generation"> &
    Partial<Pick<VoiceProvider, "sendContext">> & {
      diagnostics?: { serverInterruptions: number; turnCompletions: number; lastInterruptedAtMs?: number };
    };
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
  key: async (signal, provider = "google") =>
    (await createDefaultLiveCredentialService(signal, provider)).loadKey(signal),
  voice: (callbacks, orchestration, provider = "google") =>
    provider === "openai"
      ? new OpenAIRealtimeSession(callbacks, undefined, orchestration)
      : new VoiceSession(callbacks, undefined, orchestration),
  host: getLiveHost,
  audio: (callbacks, signal) => LiveAudio.launch({ callbacks, signal }),
};

type NativeAudio = Awaited<ReturnType<LiveDependencies["audio"]>>;
type NativeVoice = ReturnType<LiveDependencies["voice"]>;

/** Native full-duplex voice; configured agent work has an independent lifecycle. */
export default function liveExtension(pi: ExtensionAPI, injected: Partial<LiveDependencies> = {}): void {
  const deps = { ...defaults, ...injected };
  let selectedProvider: LiveProviderId = "google";
  let current: Run | undefined;
  let sequence = 0;
  let confirmation: number | undefined;
  let entry: AbortController | undefined;
  let probe: AbortController | undefined;
  let speakerProbe: AbortController | undefined;
  class Run {
    readonly id = ++sequence;
    readonly provider = selectedProvider;
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
    private readonly waveform = new LiveWaveform();
    private waveTimer?: ReturnType<typeof setInterval>;
    readonly transcriptLog = new TranscriptLog((entry) => pi.appendEntry?.(VOICE_ENTRY, entry));
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
        send: (frame, epoch) => {
          if (!this.audio) return Promise.reject(new Error("Audio not ready"));
          this.waveform.scheduled(frame, performance.now(), this.playback.state.nativeQueuedMs);
          return this.audio.play(frame, epoch);
        },
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
      const status =
        "Live " +
        presentation +
        "  " +
        (this.state === "running" ? this.waveform.tick(this.speaking, performance.now()) : "··········");
      if (status !== this.lastStatus) {
        this.ctx.ui.setStatus(ID, status);
        this.lastStatus = status;
      }
      const visible = [...this.lines.slice(-1), ...this.transcriptLog.view(clean)].slice(-MAX_VISIBLE);
      const widget = JSON.stringify(visible);
      if (widget !== this.lastWidget) {
        this.ctx.ui.setWidget(ID, visible.length ? visible : undefined);
        this.lastWidget = widget;
      }
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
      this.transcriptLog.finish("Voice", "interrupted");
      this.transcriptLog.finish("You", "partial");
      this.generation = epoch;
      this.pendingBytes = 0;
      this.queuedMs = 0;
      this.speaking = false;
      this.generationFinished = false;
      this.heardQueue = false;
      this.waveform.resetOutput();
      this.playback.interrupt(epoch);
      this.render(true);
    }
    fail(message: string) {
      if (!this.alive) return;
      this.stop();
      this.ctx.ui.notify("Live stopped: " + message + ". No agent work was cancelled.", "warning");
    }
    stop() {
      if (current !== this) return;
      this.transcriptLog.finish("You", "partial");
      this.transcriptLog.finish("Voice", "partial");
      current = undefined;
      this.orchestration?.beginUserTurn?.();
      this.inputUtterance = "";
      this.controller.abort();
      this.unsubscribeHost?.();
      this.unsubscribeHost = undefined;
      this.state = "off";
      this.playback.close();
      if (this.waveTimer) clearInterval(this.waveTimer);
      this.waveTimer = undefined;
      this.waveform.resetOutput();
      this.pendingBytes = 0;
      this.lines.length = 0;
      this.transcriptLog.reset();
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
                this.waveform.capture(pcm);
                this.voice?.sendAudio(pcm.toString("base64"));
                this.render();
              }
            },
            played: (ms) => {
              if (this.alive) {
                this.queuedMs = ms;
                if (ms > 0) this.heardQueue = true;
                this.playback.nativeQueued(ms);
                this.waveform.queued(performance.now(), ms);
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
            getPlayedAudioMs: () => this.playback.playedMs,
            onInterrupted: (epoch) => this.interrupt(epoch),
            onTurnComplete: () => {
              if (this.alive) {
                this.transcriptLog.finish("Voice", "turn-boundary");
                this.transcriptLog.finish("You", "partial");
                this.turns++;
                this.generationFinished = true;
                this.playback.turnComplete(this.generation);
                this.drain();
                this.render();
              }
            },
            onInputActivity: () => {
              if (!this.alive) return;
              this.orchestration?.beginUserTurn?.();
              this.inputUtterance = "";
              this.transcriptLog.finish("You", "partial");
            },
            onInputTranscript: (t) => {
              if (!this.alive) return;
              // Realtime ASR is item-correlated and may arrive out of order. Its
              // provider owns capture authority; received display text must not
              // re-authorize stale speech. Keep Gemini's existing capture path.
              if (this.provider === "openai") {
                if (t.finished) this.completedInputTranscripts++;
                this.transcriptLog.receive("You", t);
                this.render();
                return;
              }
              // Contract-final events are complete segments, not deltas. Latest
              // segment replaces prior unfinished input; never append after dispatch.
              if (t.finalitySource === "model_contract") this.inputUtterance = "";
              if (!this.inputUtterance && t.text) this.orchestration?.beginUserTurn?.();
              this.inputUtterance = (this.inputUtterance + t.text).slice(0, 4001);
              if (t.finished) {
                this.completedInputTranscripts++;
                this.orchestration?.userTranscript(this.inputUtterance);
                this.inputUtterance = "";
              }
              this.transcriptLog.receive("You", t);
              this.render();
            },
            onOutputTranscript: (t) => {
              if (!this.alive) return;
              this.transcriptLog.receive("Voice", t.interrupted ? { ...t, finished: false } : t);
              if (t.interrupted) this.transcriptLog.finish("Voice", "interrupted");
              this.render();
            },
            onError: (e) => this.fail("Provider " + e.code),
          },
          this.orchestration,
          this.provider,
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
        this.waveTimer = setInterval(() => this.render(true), 80);
        this.waveTimer.unref?.();
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
    description: "Toggle voice with selected voice provider (paid; microphone and speakers)",
    getArgumentCompletions: (prefix) => {
      const matches = ["start", "stop", "setup", "status", "provider", "mic-check", "speaker-check"].filter((value) =>
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
                LIVE_PROVIDERS[current.provider].label +
                " voice model " +
                LIVE_PROVIDERS[current.provider].voiceModel +
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
                  : "Live off · " +
                    LIVE_PROVIDERS[selectedProvider].label +
                    " voice model " +
                    LIVE_PROVIDERS[selectedProvider].voiceModel +
                    ". Coding-agent model is configured separately.",
          "info",
        );
      } else if (action === "provider" || action.startsWith("provider ")) {
        if (active) {
          ctx.ui.notify("Live is busy; stop it before changing voice provider.", "info");
          return;
        }
        const owner = ++sequence;
        const requested = action.slice("provider".length).trim();
        let choice: LiveProviderId | undefined;
        if (requested === "google" || requested === "openai") choice = requested;
        else if (!requested) {
          const options = (["google", "openai"] as const).map(
            (id) =>
              `${LIVE_PROVIDERS[id].label} · voice model ${LIVE_PROVIDERS[id].voiceModel}${selectedProvider === id ? " (selected)" : ""}`,
          );
          const picked = await ctx.ui.select("Live voice provider (coding-agent model is separate)", options);
          choice = picked === options[0] ? "google" : picked === options[1] ? "openai" : undefined;
        } else {
          ctx.ui.notify("Usage: /live provider [google|openai]", "info");
          return;
        }
        if (
          choice &&
          sequence === owner &&
          !current &&
          !entry &&
          confirmation === undefined &&
          !probe &&
          !speakerProbe
        ) {
          selectedProvider = choice;
          ctx.ui.notify(
            "Live voice provider: " +
              LIVE_PROVIDERS[choice].label +
              " · voice model " +
              LIVE_PROVIDERS[choice].voiceModel +
              ". Coding-agent model is separate.",
            "info",
          );
        }
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
              key = await deps.key(controller.signal, selectedProvider);
            } catch {
              // Missing or incompatible auth gets focused setup, never a raw provider error.
            }
          }
          if (!alive()) return;
          if (!key) {
            const credentials = await deps.credentials(controller.signal, selectedProvider);
            if (!alive()) return;
            const start =
              selectedProvider === "google"
                ? await runLiveSetup(ctx.ui, credentials, controller.signal)
                : await runOpenAISetup(ctx.ui, credentials, controller.signal);
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
          if (alive())
            ctx.ui.notify(
              "Could not read " + LIVE_PROVIDERS[selectedProvider].label + " API key. Try /live setup.",
              "warning",
            );
        } finally {
          if (entry === controller) entry = undefined;
        }
      } else if (action)
        ctx.ui.notify("Usage: /live [start|setup|stop|status|provider|mic-check|speaker-check]", "info");
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

/** OpenAI Live only accepts the canonical openai API key, never openai-codex OAuth. */
async function runOpenAISetup(
  ui: Pick<ExtensionContext["ui"], "select" | "notify">,
  credentials: LiveCredentialService,
  signal: AbortSignal,
): Promise<boolean> {
  let explained = false;
  while (!signal.aborted) {
    const status = await credentials.status(signal);
    if (signal.aborted) return false;
    if (status.state === "stored_api_key" || status.state === "configured_api_key") {
      const choice = await ui.select("OpenAI Live voice model (coding-agent model is separate)", [
        "Start voice",
        "Done",
      ]);
      return !signal.aborted && choice === "Start voice";
    }
    if (!explained) {
      ui.notify(
        "OpenAI Live requires a canonical openai provider API key in agent auth. ChatGPT subscriptions and openai-codex OAuth do not work. Use /login → Sign in with an API key → OpenAI, then /live setup. Never paste keys into chat.",
        "info",
      );
      explained = true;
    }
    const choice = await ui.select("OpenAI API key required", ["Recheck", "Cancel"]);
    if (signal.aborted || choice !== "Recheck") return false;
  }
  return false;
}
