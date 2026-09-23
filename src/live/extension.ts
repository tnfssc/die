import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { checkAudioCapabilities, createLocalAudioAdapter } from "./audio";
import { createCurrentSessionBridge, type CurrentSessionBridge, type LiveBridgeEvent } from "./bridge";
import { createDefaultLiveCredentialService } from "./credentials";
import { testLiveConnection } from "./connection-test";
import { runLiveSetup, type LiveSetupStatus } from "./setup";
import { liveLocalOnly, liveStatus } from "./status";
import { LiveTransport, type LiveCall, type LiveCallbacks } from "./transport";

type Audio = ReturnType<typeof createLocalAudioAdapter>;
type Transport = Pick<LiveTransport, "connect" | "sendAudio" | "respond" | "close">;
export interface LiveDependencies {
  local(mode: string): boolean;
  capabilities: typeof checkAudioCapabilities;
  key(): Promise<string>;
  credentialStatus(): Promise<LiveSetupStatus>;
  importKey(signal?: AbortSignal): Promise<void>;
  audio(): Audio;
  transport(callbacks: LiveCallbacks): Transport;
}
const defaults: LiveDependencies = {
  local: (mode) => liveLocalOnly(mode, process.env, Boolean(process.stdin.isTTY && process.stdout.isTTY)),
  capabilities: checkAudioCapabilities,
  key: async () => (await createDefaultLiveCredentialService()).loadKey(),
  credentialStatus: async () => {
    const status = await (await createDefaultLiveCredentialService()).status();
    const configured = status.state === "stored_api_key" || status.state === "configured_api_key";
    const message =
      status.state === "oauth"
        ? "Google OAuth is present and will not be replaced. Live needs a Google API key; manage provider auth separately."
        : configured
          ? "Google API key configured (hidden; account access not tested). Existing provider auth will be reused."
          : "No Google API key configured. Add a secure local file, then explicitly import it into provider auth.";
    return { configured, canImport: status.canImport, message };
  },
  importKey: async (signal) => {
    const result = await (await createDefaultLiveCredentialService()).importLiveEnv(undefined, signal);
    if (!result.imported) throw new Error("Google auth changed; refresh setup without overwriting it.");
  },
  audio: createLocalAudioAdapter,
  transport: (callbacks) => new LiveTransport(callbacks),
};

/** One Live connection alongside, never instead of, the existing die session. */
export default function liveExtension(pi: ExtensionAPI, dependencies: Partial<LiveDependencies> = {}): void {
  const deps = { ...defaults, ...dependencies };
  let active: { stop(): void } | undefined;
  let setupController: AbortController | undefined;
  let epoch = 0;
  let sequence = 0;
  const stop = () => {
    epoch++;
    setupController?.abort();
    setupController = undefined;
    active?.stop();
    active = undefined;
  };
  pi.on("session_shutdown", stop);
  pi.on("session_start", stop);

  async function start(ctx: ExtensionContext): Promise<void> {
    if (active) {
      ctx.ui.notify("Live is already starting or listening.", "info");
      return;
    }
    if (!deps.local(ctx.mode)) {
      ctx.ui.notify("Live is local interactive CLI only (no SSH, web, or child agent sessions).", "warning");
      return;
    }
    setupController?.abort();
    setupController = undefined;
    const token = ++epoch;
    let audio: Audio | undefined;
    let transport: Transport | undefined;
    let bridge: CurrentSessionBridge | undefined;
    let audioReady = false;
    let tick: ReturnType<typeof setInterval> | undefined;
    let level = 0;
    let lastStatus = "";
    const calls = new Map<string, { requestId: string; ended: boolean }>();
    const recent = new Set<string>();
    let channel: string | undefined;
    const forget = (id: string) => {
      calls.delete(id);
      recent.add(id);
      if (recent.size > 64) recent.delete(recent.values().next().value!);
      if (channel === id) channel = [...calls.keys()].at(-1);
    };
    const show = (connecting = false) => {
      const status = liveStatus(level, connecting);
      if (status !== lastStatus) {
        lastStatus = status;
        ctx.ui.setStatus("die-live", status);
      }
    };
    const current = () => token === epoch;
    const cleanup = () => {
      clearInterval(tick);
      bridge?.stop();
      transport?.close();
      audio?.close();
      calls.clear();
      recent.clear();
      channel = undefined;
      ctx.ui.setStatus("die-live", undefined);
    };
    active = { stop: cleanup };
    const fail = (message: string) => {
      if (!current()) return;
      stop();
      ctx.ui.notify(message + " Agent work was not cancelled.", "warning");
    };
    show(true);
    try {
      const capability = await deps.capabilities();
      if (!current()) return;
      if (!capability.supported) {
        fail(capability.reason ?? "Local SoX audio is unavailable.");
        return;
      }
      const key = await deps.key();
      if (!current()) return;
      bridge = createCurrentSessionBridge(pi, {
        onSessionEvent: (event) => {
          // This channel observes the whole configured session, including later
          // background resumptions. It never attributes unrelated work to a request.
          if (!current() || !channel || !calls.has(channel)) return;
          transport?.respond(
            channel,
            { event, note: "Current-session observation, not proof of a particular handoff completing." },
            true,
            event.type === "assistant_reply" ? "WHEN_IDLE" : "SILENT",
          );
        },
      });
      audio = deps.audio();
      const observe = (id: string, event: LiveBridgeEvent) => {
        const call = calls.get(id);
        if (!current() || !call) return;
        if (event.type === "delivery_failed") {
          transport?.respond(id, { event, note: "Delivery failed; do not claim work started." }, false);
          forget(id);
        } else if (event.type === "run_ended" || event.type === "association_ended") {
          call.ended = true;
          transport?.respond(
            id,
            { event, note: "Request observation boundary, NOT proof that background work completed." },
            id === channel,
            "SILENT",
          );
          if (id !== channel) forget(id);
        } else if (event.type === "accepted") {
          transport?.respond(
            id,
            { event, note: "Request observed in the current session; not work completion." },
            true,
            "SILENT",
          );
        }
      };
      const handoff = (call: LiveCall) => {
        if (!current()) return;
        if (call.name !== "handoff") {
          fail("Live requested an unsupported tool.");
          return;
        }
        if (calls.has(call.id) || recent.has(call.id)) return; // Gemini retransmission is not a second user request.
        if (calls.size >= 8 && !(channel && calls.get(channel)?.ended)) {
          transport?.respond(
            call.id,
            { error: "Live handoff tracking is full; use the terminal or restart Live. Existing work continues." },
            false,
          );
          return;
        }
        const requestId = "live-" + ++sequence;
        const result = bridge!.handoff({
          requestId,
          message: typeof call.args.request === "string" ? call.args.request : "",
          onEvent: (event) => observe(call.id, event),
        });
        const queued = result.status === "queued" || result.status === "duplicate";
        if (queued) {
          if (channel && calls.get(channel)?.ended) {
            transport?.respond(
              channel,
              { note: "Session observation moves to the next handoff; existing work continues." },
              false,
              "SILENT",
            );
            forget(channel);
          }
          calls.set(call.id, { requestId, ended: false });
          channel = call.id;
        }
        transport?.respond(
          call.id,
          { ...result, note: "Queued is not completion; keep conversing while work runs." },
          queued,
          "SILENT",
        );
      };
      transport = deps.transport({
        ready: () => {
          if (!current()) return;
          void audio!
            .start(
              (data) => {
                if (current()) transport?.sendAudio(data);
              },
              (value) => {
                level = Math.max(level, Math.min(1, value * 6));
              },
              () => fail("Local audio failed; Live stopped."),
            )
            .then(() => {
              if (!current()) {
                audio?.close();
                return;
              }
              audioReady = true;
              show();
              tick = setInterval(() => {
                show();
                level *= 0.45;
              }, 100);
              tick.unref?.();
            })
            .catch(() => fail("Could not start local microphone/speaker audio."));
        },
        audio: (data) => {
          if (!current() || !audioReady) return;
          audio!.play(data);
          const pcm = Buffer.from(data, "base64");
          let squares = 0;
          for (let i = 0; i + 1 < pcm.length; i += 2) squares += (pcm.readInt16LE(i) / 32768) ** 2;
          level = Math.max(level, Math.min(1, Math.sqrt(squares / Math.max(1, pcm.length / 2)) * 6));
        },
        interrupted: () => {
          if (current()) audio?.interrupt();
        },
        call: handoff,
        cancelled: (ids) => {
          // Gemini cancelled its response channel, not the user's work.
          for (const id of ids) {
            const request = calls.get(id);
            if (request) bridge?.cancel(request.requestId);
            forget(id);
          }
        },
        closed: fail,
      });
      transport.connect(key);
    } catch {
      fail("Live could not start. Run /live setup to check Google credentials and local SoX audio.");
    }
  }

  pi.registerCommand("live", {
    description: "Local live conversation: setup, start, stop, status, cancel-work",
    handler: async (args, ctx) => {
      let action = args.trim();
      if (!action) {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Live is local interactive CLI only.", "warning");
          return;
        }
        const choice = await ctx.ui.select("Gemini Live", [
          "Setup / review",
          "Start microphone + speakers (paid API)",
          "Stop Live (keep work running)",
          "Cancel current agent turn",
        ]);
        action =
          choice === "Start microphone + speakers (paid API)"
            ? "start"
            : choice === "Stop Live (keep work running)"
              ? "stop"
              : choice === "Setup / review"
                ? "setup"
                : choice === "Cancel current agent turn"
                  ? "cancel-work"
                  : "";
        if (!action) return;
      }
      if (action === "start") {
        await start(ctx);
        return;
      }
      if (action === "stop") {
        stop();
        ctx.ui.notify("Live stopped. Agent work continues.", "info");
        return;
      }
      if (action === "status") {
        ctx.ui.notify(
          active
            ? "Live starting/listening; /live stop closes audio only."
            : "Live off. No microphone or connection active.",
          "info",
        );
        return;
      }
      if (action === "setup") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Live setup is local interactive CLI only (no SSH, web, or child agent sessions).", "warning");
          return;
        }
        if (active || setupController) {
          ctx.ui.notify(
            active
              ? "Live is active. Stop Live before running setup; agent work will continue."
              : "Live setup is already open.",
            "info",
          );
          return;
        }
        const controller = new AbortController();
        setupController = controller;
        try {
          await runLiveSetup(ctx.ui, {
            status: deps.credentialStatus,
            importKey: () => deps.importKey(controller.signal),
            capabilities: deps.capabilities,
            isCurrent: () => !controller.signal.aborted,
            testConnection: async () => {
              const key = await deps.key();
              if (controller.signal.aborted) return;
              await testLiveConnection(key, { signal: controller.signal, transport: deps.transport });
            },
            start: () => start(ctx),
          });
        } catch {
          if (!controller.signal.aborted)
            ctx.ui.notify("Live setup could not complete. Run /live setup to retry.", "warning");
        } finally {
          controller.abort();
          if (setupController === controller) setupController = undefined;
        }
        return;
      }
      if (action === "cancel-work") {
        if (!deps.local(ctx.mode)) return;
        if (
          await ctx.ui.confirm(
            "Cancel agent turn?",
            "Abort the current configured agent turn? Queued followups and background jobs may continue; cancel those separately with jobs.stop. Audio interruption alone never cancels work.",
          )
        ) {
          ctx.abort();
          ctx.ui.notify("Agent abort requested. Background jobs may still be running.", "info");
        }
        return;
      }
      ctx.ui.notify("Usage: /live [start|stop|status|setup|cancel-work]", "info");
    },
  });
}
