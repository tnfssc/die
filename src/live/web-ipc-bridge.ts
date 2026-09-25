import { Socket } from "node:net";
import type { SessionHost, SessionHostLease } from "../session/host";
import { createDefaultLiveCredentialService } from "./credentials";
import { createWebProviderFactory } from "./web-providers";
import { createWebLiveRelay, type WebRelayProviderFactory, type WebRelayTransport } from "./web-relay";
import { OPENAI_REALTIME_MODELS, VOICE_MODEL } from "./providers";

// Private, spawn-scoped FD protocol. No key, host operation or permission response crosses it.
const MAX_CONTROL = 16 * 1024;
const MAX_AUDIO = 64 * 1024;
const MAX_PENDING = 128 * 1024;
export type PrivateVoiceChannel = Pick<Socket, "on" | "off" | "write" | "destroy" | "writableLength">;
type Control = { type: string; [key: string]: unknown };

export function attachWebVoiceIpc(options: {
  channel: PrivateVoiceChannel;
  host: () => SessionHost | undefined;
  key?: (provider: "google" | "openai") => Promise<string>;
  factory?: (provider: "google" | "openai", model: string) => WebRelayProviderFactory;
}): { close(): void; stop(): { stopped: boolean } } {
  const { channel } = options;
  let incoming = Buffer.alloc(0);
  let active: { lease: SessionHostLease; relay: ReturnType<typeof createWebLiveRelay> } | undefined;
  let generation = 0;
  let closed = false;
  let pending = false;
  let listeners: { message?: (data: unknown) => void; close?: () => void } = {};
  function frame(kind: number, bytes: Uint8Array) {
    if (closed || bytes.length > (kind === 0 ? MAX_CONTROL : MAX_AUDIO) || channel.writableLength + bytes.length + 5 > MAX_PENDING)
      throw new Error("Private voice channel unavailable");
    const header = Buffer.allocUnsafe(5);
    header[0] = kind;
    header.writeUInt32BE(bytes.length, 1);
    channel.write(Buffer.concat([header, bytes]));
  }
  function control(value: Control) { frame(0, Buffer.from(JSON.stringify(value))); }
  function end(): { stopped: boolean } {
    ++generation;
    const old = active;
    old?.lease.revoke();
    let stopped = true;
    try { if (old) stopped = old.relay.close().stopped; } catch { stopped = false; }
    if (stopped) { active = undefined; listeners = {}; }
    return { stopped };
  }
  function fail() {
    if (closed) return;
    end();
    closed = true;
    channel.off("data", receive);
    channel.off("close", fail);
    channel.off("error", fail);
    channel.destroy();
  }
  function transport(leaseForTransport: SessionHostLease): WebRelayTransport {
    let live = true;
    return {
      get bufferedAmount() { return channel.writableLength; },
      send(data) {
        if (!live) throw new Error("Voice transport closed");
        if (typeof data === "string") {
          const value = JSON.parse(data) as Control;
          control(value.type === "ready" ? { type: "status", state: "ready" } :
            value.type === "closed" ? { type: "status", state: "closed" } :
            value.type === "interrupted" ? { type: "interrupt", epoch: value.epoch } : value);
        } else frame(2, data);
      },
      onMessage(fn) { listeners.message = fn; return () => { if (listeners.message === fn) listeners.message = undefined; }; },
      onClose(fn) { listeners.close = fn; return () => { if (listeners.close === fn) listeners.close = undefined; }; },
      close() { live = false; queueMicrotask(() => { if (active?.lease === leaseForTransport) end(); }); },
    };
  }
  async function start(message: Control) {
    if (!end().stopped) { control({ type: "error", code: "teardown_failed" }); return; }
    const mine = generation;
    const provider = message.provider === "gemini" ? "google" : message.provider === "openai" ? "openai" : undefined;
    const model = message.model === undefined ? (provider === "google" ? VOICE_MODEL : OPENAI_REALTIME_MODELS[0]) : message.model;
    if (!provider || typeof model !== "string" || (provider === "google" ? model !== VOICE_MODEL : !(OPENAI_REALTIME_MODELS as readonly string[]).includes(model))) {
      control({ type: "error", code: "unsupported_provider" }); return;
    }
    const host = options.host();
    if (!host) { control({ type: "error", code: "no_owner" }); return; }
    const lease = host.lease();
    const signal = { valid: () => !closed && mine === generation && active?.lease === lease, onRevoke: (_fn: () => void) => () => {} };
    try {
      const key = await (options.key ?? (async (id) => (await createDefaultLiveCredentialService(undefined, id)).loadKey()))(provider);
      if (closed || mine !== generation || options.host() !== host) { lease.revoke(); return; }
      const relay = createWebLiveRelay({ host: lease, apiKey: key, providerFactory: (options.factory ?? createWebProviderFactory)(provider, model), transport: transport(lease), authority: signal });
      active = { lease, relay };
      control({ type: "started" });
      void relay.start().catch(() => { if (active?.relay === relay) end(); });
    } catch {
      lease.revoke();
      if (!closed && mine === generation) control({ type: "error", code: "start_failed" });
    }
  }
  function dispatch(kind: number, bytes: Buffer) {
    if (kind === 1) {
      if (!active || bytes.length > 3200 || !bytes.length || bytes.length % 2) throw new Error("Invalid audio frame");
      listeners.message?.(bytes);
      return;
    }
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Invalid control"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid control");
    const msg = value as Control;
    if (msg.type === "start" && !pending) {
      if (Object.keys(msg).some((key) => !["type", "provider", "model"].includes(key))) throw new Error("Invalid start");
      pending = true;
      void start(msg).catch(() => { if (!closed) { try { control({ type: "error", code: "start_failed" }); } catch { fail(); } } }).finally(() => { pending = false; });
    } else if (msg.type === "stop" && Object.keys(msg).length === 1) end();
    else if (msg.type === "mute" && typeof msg.muted === "boolean" && Object.keys(msg).length === 2) listeners.message?.(JSON.stringify(msg));
    else if (msg.type === "interrupt" && Object.keys(msg).length === 1) {
      // The relay has no explicit provider interrupt primitive; never leave capture silently muted.
      end();
      control({ type: "error", code: "interrupt_unsupported" });
    }
    else throw new Error("Invalid control");
  }
  function receive(chunk: Buffer) {
    if (closed) return;
    try {
      if (incoming.length + chunk.length > MAX_PENDING) throw new Error("Inbound overflow");
      incoming = Buffer.concat([incoming, chunk]);
      while (incoming.length >= 5) {
        const kind = incoming[0]; const length = incoming.readUInt32BE(1);
        if ((kind !== 0 && kind !== 1) || length > (kind === 0 ? MAX_CONTROL : MAX_AUDIO)) throw new Error("Invalid frame");
        if (incoming.length < 5 + length) break;
        const bytes = incoming.subarray(5, 5 + length);
        incoming = incoming.subarray(5 + length);
        dispatch(kind, bytes);
      }
    } catch { fail(); }
  }
  channel.on("data", receive);
  channel.on("close", fail);
  channel.on("error", fail);
  control({ type: "ready", protocol: 1 });
  return { close: fail, stop: end };
}

/** Only the Pi spawn that explicitly received FD3 enables the root bridge. */
export function attachSpawnWebVoiceIpc(host: () => SessionHost | undefined) {
  const enabled = process.env.DIE_WEB_VOICE_FD === "3" && process.env.DIE_WEB_VOICE_OUTPUT_FD === "4";
  delete process.env.DIE_WEB_VOICE_FD;
  delete process.env.DIE_WEB_VOICE_OUTPUT_FD;
  if (!enabled) return undefined;
  const input = new Socket({ fd: 3, readable: true, writable: false });
  const output = new Socket({ fd: 4, readable: false, writable: true });
  const channel = {
    get writableLength() { return output.writableLength; },
    on(event: string, listener: (...args: any[]) => void) { input.on(event, listener); if (event === "error" || event === "close") output.on(event, listener); return this; },
    off(event: string, listener: (...args: any[]) => void) { input.off(event, listener); if (event === "error" || event === "close") output.off(event, listener); return this; },
    write(data: Uint8Array) { return output.write(data); },
    destroy() { input.destroy(); output.destroy(); return this; },
  };
  return attachWebVoiceIpc({ channel: channel as PrivateVoiceChannel, host });
}
