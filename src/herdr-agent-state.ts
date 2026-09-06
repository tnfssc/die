import type { ExtensionAPI, ExtensionContext, SessionShutdownEvent } from "@earendil-works/pi-coding-agent";
import net, { type Socket } from "node:net";
import { isAbsolute } from "node:path";

/** Built-in Herdr reporting derived from Herdr's managed Pi integration v6. */
const SOURCE = "herdr:die";
// Herdr 0.7.x does not render a die identity, so use its compatible Pi identity.
const COMPATIBLE_AGENT = "pi";
const FIRST_TIMEOUT_MS = 250;
const RETRY_TIMEOUT_MS = 750;
const MAX_PANE_ID_LENGTH = 512;
const MAX_SESSION_PATH_LENGTH = 4096;
const MAX_SESSION_ID_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 512;
const MAX_ENDPOINT_LENGTH = 4096;

type AgentState = "working" | "blocked" | "idle";
type SessionRef = { agent_session_path: string } | { agent_session_id: string };
type Request = {
  id: string;
  method: Method;
  params: Record<string, unknown>;
};
type Method = "pane.report_agent_session" | "pane.report_agent" | "pane.release_agent";
type PendingRequest = { kind: "session" | "state" | "release"; method: Method; params: Record<string, unknown> };
type BlockedEvent = { active?: boolean; label?: string };
type Connect = (endpoint: string) => Socket;
type RuntimeConfig = { paneId: string; endpoint: string; connect: Connect };

let reportSeq = Date.now() * 1000;
let authority: HerdrRuntime | undefined;

function nextSeq(): number {
  reportSeq += 1;
  return reportSeq;
}

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127 ? " " : character;
    })
    .join("")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, limit);
}

function readConfig(connect: Connect = (endpoint) => net.createConnection(endpoint)): RuntimeConfig | undefined {
  const socketPath = process.env.HERDR_SOCKET_PATH;
  const paneId = boundedText(process.env.HERDR_PANE_ID, MAX_PANE_ID_LENGTH);
  const rawDepth = process.env.DIE_SUBAGENT_DEPTH ?? "0";
  const childRole = process.env.DIE_SUBAGENT_TYPE?.trim();
  if (!/^(0|[1-9]\d*)$/.test(rawDepth)) return undefined;
  const depth = Number(rawDepth);
  if (
    process.env.HERDR_ENV !== "1" ||
    !socketPath ||
    socketPath.length > MAX_ENDPOINT_LENGTH ||
    socketPath.includes("\0") ||
    !paneId ||
    !Number.isSafeInteger(depth) ||
    depth !== 0 ||
    childRole
  )
    return undefined;
  return {
    paneId,
    endpoint: process.platform === "win32" ? "\\\\.\\pipe\\" + socketPath : socketPath,
    connect,
  };
}

function sessionRef(ctx: ExtensionContext): SessionRef | undefined {
  try {
    const path = boundedText(ctx.sessionManager.getSessionFile(), MAX_SESSION_PATH_LENGTH);
    if (path && isAbsolute(path)) return { agent_session_path: path };
  } catch {
    // An embedder's session manager can be temporarily unavailable while switching.
  }
  try {
    const id = boundedText(ctx.sessionManager.getSessionId(), MAX_SESSION_ID_LENGTH);
    if (id) return { agent_session_id: id };
  } catch {
    // State is still useful when no session identity is available.
  }
  return undefined;
}

class HerdrRuntime {
  private active = false;
  private shuttingDown = false;
  private agentActive = false;
  private blockedCount = 0;
  private blockedMessage: string | undefined;
  private lastState: AgentState | undefined;
  private lastMessage: string | undefined;
  private currentRef: SessionRef | undefined;
  private pending: PendingRequest[] = [];
  private pumpPromise: Promise<void> | undefined;
  private epoch = 0;
  private sockets = new Set<Socket>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private unsubscribeBlocked: (() => void) | undefined;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly config: RuntimeConfig,
  ) {}

  register(): void {
    this.pi.on("session_start", (event, ctx) => {
      if (ctx.hasUI !== true) return;
      this.claim(ctx);
      this.reportSession(event.reason);
      this.agentActive = ctx.isIdle() === false;
      this.publish(true);
    });
    this.pi.on("agent_start", (_event, ctx) => {
      if (!this.owns()) return;
      this.currentRef = sessionRef(ctx);
      this.reportSession();
      this.agentActive = true;
      this.publish();
    });
    this.pi.on("agent_settled", (_event, ctx) => {
      if (!this.owns() || ctx.isIdle() !== true) return;
      this.agentActive = false;
      this.publish();
    });
    this.pi.on("ui_prompt_start", (event) => {
      if (this.owns()) this.setBlocked(true, event.title ?? "waiting for user input");
    });
    this.pi.on("ui_prompt_end", () => {
      if (this.owns()) this.setBlocked(false);
    });
    this.pi.on("session_shutdown", (event) => this.shutdown(event));
  }

  private ensureBlockedListener(): void {
    if (this.unsubscribeBlocked) return;
    this.unsubscribeBlocked = this.pi.events.on("herdr:blocked", (data) => {
      if (!this.owns()) return;
      const event = typeof data === "object" && data !== null ? (data as BlockedEvent) : undefined;
      this.setBlocked(event?.active === true, event?.label);
    });
  }

  private owns(): boolean {
    return this.active && authority === this;
  }

  private claim(ctx: ExtensionContext): void {
    if (authority && authority !== this) authority.deactivate(false);
    this.deactivate(false);
    authority = this;
    this.active = true;
    this.currentRef = sessionRef(ctx);
    this.lastState = undefined;
    this.lastMessage = undefined;
    this.ensureBlockedListener();
  }

  private setBlocked(active: boolean, label?: string): void {
    if (active) {
      this.blockedCount += 1;
      this.blockedMessage = boundedText(label, MAX_MESSAGE_LENGTH);
    } else {
      this.blockedCount = Math.max(0, this.blockedCount - 1);
      if (this.blockedCount === 0) this.blockedMessage = undefined;
    }
    this.publish();
  }

  private publish(force = false): void {
    if (!this.owns()) return;
    const state: AgentState = this.blockedCount > 0 ? "blocked" : this.agentActive ? "working" : "idle";
    const message = state === "blocked" ? this.blockedMessage : undefined;
    if (!force && state === this.lastState && message === this.lastMessage) return;
    this.lastState = state;
    this.lastMessage = message;
    this.enqueue({
      kind: "state",
      method: "pane.report_agent",
      params: {
        pane_id: this.config.paneId,
        source: SOURCE,
        agent: COMPATIBLE_AGENT,
        state,
        ...(message ? { message } : {}),
        ...this.currentRef,
      },
    });
  }

  private reportSession(sessionStartSource?: string): void {
    if (!this.owns() || !this.currentRef) return;
    const startSource = boundedText(sessionStartSource, 32);
    this.enqueue({
      kind: "session",
      method: "pane.report_agent_session",
      params: {
        pane_id: this.config.paneId,
        source: SOURCE,
        agent: COMPATIBLE_AGENT,
        ...(startSource ? { session_start_source: startSource } : {}),
        ...this.currentRef,
      },
    });
  }

  private enqueue(request: PendingRequest): void {
    const existing = this.pending.find((item) => item.kind === request.kind);
    if (existing) {
      existing.method = request.method;
      existing.params = request.params;
    } else this.pending.push(request);
    void this.startPump();
  }

  private materialize(request: PendingRequest): Request {
    return {
      id: SOURCE + ":" + request.kind + ":" + Date.now() + ":" + Math.random().toString(36).slice(2),
      method: request.method,
      params: { ...request.params, seq: nextSeq() },
    };
  }

  private startPump(): Promise<void> {
    if (!this.pumpPromise) {
      this.pumpPromise = this.pump().finally(() => {
        this.pumpPromise = undefined;
        if (this.pending.length > 0 && (this.active || (this.shuttingDown && authority === this)))
          void this.startPump();
      });
    }
    return this.pumpPromise;
  }

  private async pump(): Promise<void> {
    while (this.pending.length > 0 && (this.active || (this.shuttingDown && authority === this))) {
      const request = this.pending.shift();
      if (!request) break;
      const epoch = this.epoch;
      await this.send(request, epoch);
    }
  }

  private async send(request: PendingRequest, epoch: number): Promise<void> {
    if (await this.attempt(this.materialize(request), FIRST_TIMEOUT_MS)) return;
    if (epoch === this.epoch && (this.active || (this.shuttingDown && authority === this))) {
      await this.attempt(this.materialize(request), RETRY_TIMEOUT_MS);
    }
  }

  private attempt(request: Request, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let socket: Socket;
      try {
        socket = this.config.connect(this.config.endpoint);
      } catch {
        resolve(false);
        return;
      }
      this.sockets.add(socket);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let done = false;
      const finish = (delivered: boolean) => {
        if (done) return;
        done = true;
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(timer);
        }
        this.sockets.delete(socket);
        socket.destroy();
        resolve(delivered);
      };
      socket.once("error", () => finish(false));
      socket.once("connect", () => {
        try {
          socket.write(JSON.stringify(request) + "\n");
        } catch {
          finish(false);
        }
      });
      socket.once("data", () => finish(true));
      socket.once("end", () => finish(false));
      socket.once("close", () => finish(false));
      timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
      this.timers.add(timer);
    });
  }

  private clearTransport(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  private deactivate(clearAuthority: boolean): void {
    this.active = false;
    this.shuttingDown = false;
    this.agentActive = false;
    this.pending = [];
    this.blockedCount = 0;
    this.blockedMessage = undefined;
    this.currentRef = undefined;
    this.epoch += 1;
    this.clearTransport();
    this.unsubscribeBlocked?.();
    this.unsubscribeBlocked = undefined;
    if (clearAuthority && authority === this) authority = undefined;
  }

  private async shutdown(event: SessionShutdownEvent): Promise<void> {
    if (!this.owns()) {
      this.deactivate(false);
      return;
    }
    if (event.reason !== "quit") {
      this.deactivate(true);
      return;
    }

    // Retain authority through the bounded drain. A concurrent replacement
    // cancels this runtime before claiming, including any release or retry.
    this.active = false;
    this.shuttingDown = true;
    this.agentActive = false;
    this.pending = [];
    this.epoch += 1;
    this.clearTransport();
    this.unsubscribeBlocked?.();
    this.unsubscribeBlocked = undefined;
    this.pending.push({
      kind: "release",
      method: "pane.release_agent",
      params: {
        pane_id: this.config.paneId,
        source: SOURCE,
        agent: COMPATIBLE_AGENT,
      },
    });
    await this.startPump();
    if (authority === this) authority = undefined;
    this.shuttingDown = false;
    this.pending = [];
  }
}

export function registerHerdrAgentState(pi: ExtensionAPI, connect?: Connect): void {
  const config = readConfig(connect);
  if (!config) return;
  new HerdrRuntime(pi, config).register();
}

export default registerHerdrAgentState;
