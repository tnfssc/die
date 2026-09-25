import { boundedHostContext, createOrchestration } from "./orchestration";
import type { SessionOperations } from "../session/operations";
import type { VoiceCallbacks, VoiceOrchestration, VoiceProvider } from "./types";

/** Server-only relay foundation; NOT an HTTP route. The future route MUST authenticate the
 * socket, resolve its owning session, and supply that session's SessionOperations and server-side
 * provider key. Never derive SessionOperations from client messages or expose the key to the socket.
 * Route/socket admission, origin/CSRF checks and browser capture/playback are NOT integrated here.
 * One relay per socket; no reconnect/reuse. PCM is mono signed little-endian 16-bit: input 16 kHz,
 * output 24 kHz. Binary frames are audio; JSON controls are mute/end. No job is stopped on end.
 */
export interface WebRelayTransport {
  readonly bufferedAmount: number;
  send(data: string | Uint8Array): void;
  onMessage(listener: (data: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
  close(): void;
}
export type WebRelayProviderFactory = (callbacks: VoiceCallbacks, orchestration: VoiceOrchestration) => VoiceProvider;

const MAX_BUFFERED = 256_000;
const CONNECT_MS = 10_000;
const SESSION_MS = 30 * 60_000;

export function createWebLiveRelay(options: {
  /** Already authenticated, already bound to the owning session by the future route. */
  host: SessionOperations;
  /** Server-side secret; never included in transport data or errors. */
  apiKey: string;
  transport: WebRelayTransport;
  providerFactory: WebRelayProviderFactory;
  connectDeadlineMs?: number;
  sessionDeadlineMs?: number;
}): { start(): Promise<void>; close(): void } {
  const { host, apiKey, transport, providerFactory } = options;
  const orchestration = createOrchestration(host);
  let provider: VoiceProvider | undefined;
  let started = false;
  let ended = false;
  let ready = false;
  let muted = false;
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeHost: (() => void) | undefined;
  let unsubscribeMessage: (() => void) | undefined;
  let unsubscribeClose: (() => void) | undefined;

  function send(data: string | Uint8Array): void {
    if (
      ended ||
      !Number.isFinite(transport.bufferedAmount) ||
      transport.bufferedAmount < 0 ||
      transport.bufferedAmount + (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength) > MAX_BUFFERED
    )
      throw new Error("socket backpressure");
    transport.send(data);
  }
  function control(value: object): void {
    send(JSON.stringify(value));
  }
  function finish(code?: "invalid_input" | "not_ready" | "provider_error" | "transport_error" | "timeout"): void {
    if (ended) return;
    // Do not expose provider errors (or keys) to the browser.
    if (code) {
      try {
        control({ type: "error", code });
      } catch {
        /* socket already unusable */
      }
    }
    try {
      control({ type: "closed" });
    } catch {
      /* socket already unusable */
    }
    ended = true;
    ready = false;
    if (timer) clearTimeout(timer);
    try {
      unsubscribeMessage?.();
    } catch {
      /* cleanup */
    }
    try {
      unsubscribeClose?.();
    } catch {
      /* cleanup */
    }
    try {
      unsubscribeHost?.();
    } catch {
      /* cleanup */
    }
    try {
      provider?.close();
    } catch {
      /* cleanup */
    }
    try {
      transport.close();
    } catch {
      /* cleanup */
    }
  }
  function deadline(ms: number): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => finish("timeout"), ms);
    timer.unref?.();
  }
  function message(value: unknown): void {
    if (ended) return;
    try {
      if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
        if (!ready) {
          finish("not_ready");
          return;
        }
        const pcm = value instanceof Uint8Array ? value : new Uint8Array(value);
        if (!pcm.byteLength || pcm.byteLength > 3200 || pcm.byteLength % 2) {
          finish("invalid_input");
          return;
        }
        if (!muted) provider!.sendAudio(Buffer.from(pcm).toString("base64"));
        return;
      }
      if (typeof value !== "string" || value.length > 128) {
        finish("invalid_input");
        return;
      }
      const controlValue: unknown = JSON.parse(value);
      if (!controlValue || typeof controlValue !== "object" || Array.isArray(controlValue)) {
        finish("invalid_input");
        return;
      }
      const item = controlValue as Record<string, unknown>;
      if (item.type === "end" && Object.keys(item).length === 1) {
        finish();
        return;
      }
      if (item.type === "mute" && typeof item.muted === "boolean" && Object.keys(item).length === 2) {
        muted = item.muted;
        return;
      }
      finish("invalid_input");
    } catch {
      finish("invalid_input");
    }
  }
  const callbacks: VoiceCallbacks = {
    onAudio(base64, audioEpoch) {
      if (!ready || ended || audioEpoch !== epoch) return;
      // Avoid unbounded provider output and invalid base64 crossing the socket boundary.
      if (
        base64.length > 262_144 ||
        base64.length % 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
      ) {
        finish("provider_error");
        return;
      }
      const pcm = Buffer.from(base64, "base64");
      if (pcm.byteLength % 2) {
        finish("provider_error");
        return;
      }
      try {
        for (let i = 0; i < pcm.length; i += 9600) send(pcm.subarray(i, i + 9600));
      } catch {
        finish("transport_error");
      }
    },
    onInterrupted(nextEpoch) {
      if (ended || !ready) return;
      if (!Number.isSafeInteger(nextEpoch) || nextEpoch <= epoch) {
        finish("provider_error");
        return;
      }
      epoch = nextEpoch;
      orchestration.beginUserTurn?.();
      try {
        control({ type: "interrupted", epoch });
      } catch {
        finish("transport_error");
      }
    },
    onInputActivity() {
      if (!ended) orchestration.beginUserTurn?.();
    },
    onInputTranscript(t) {
      if (!ended && t.finished && t.text) orchestration.userTranscript(t.text);
    },
    onError() {
      finish("provider_error");
    },
    onState(state) {
      if (state === "closed" && !ended) finish("provider_error");
    },
  };
  return {
    async start() {
      if (started) throw new Error("Relay is single-use");
      started = true;
      try {
        unsubscribeMessage = transport.onMessage(message);
        unsubscribeClose = transport.onClose(() => finish());
        if (ended) return;
        provider = providerFactory(callbacks, orchestration);
        if (ended) {
          provider.close();
          return;
        }
        deadline(options.connectDeadlineMs ?? CONNECT_MS);
        await provider.connect(apiKey);
        if (ended) return;
        if (provider.state !== "ready") {
          finish("provider_error");
          return;
        }
        provider.sendContext(boundedHostContext(host.context()));
        unsubscribeHost = host.subscribe((update) => {
          if (ended) return;
          try {
            provider?.sendContext(boundedHostContext(update));
          } catch {
            finish("provider_error");
          }
        });
        if (ended) {
          unsubscribeHost();
          return;
        }
        // Initial context and subscription must succeed before ready is claimed.
        epoch = provider.generation;
        if (!Number.isSafeInteger(epoch) || epoch < 0) {
          finish("provider_error");
          return;
        }
        control({ type: "ready" });
        ready = true;
        deadline(options.sessionDeadlineMs ?? SESSION_MS);
      } catch {
        finish("provider_error");
      }
    },
    close() {
      finish();
    },
  };
}
