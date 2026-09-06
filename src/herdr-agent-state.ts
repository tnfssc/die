import type { ExtensionAPI, ExtensionContext, SessionShutdownEvent } from "@earendil-works/pi-coding-agent";
import net, { type Socket } from "node:net";

/** Built-in Herdr reporting derived from Herdr's managed Pi integration v6. */
const SOURCE = "herdr:die";
// Herdr 0.7.x does not render a die identity, so use its compatible Pi identity.
const COMPATIBLE_AGENT = "pi";
const FIRST_TIMEOUT_MS = 250;
const RETRY_TIMEOUT_MS = 750;

type AgentState = "working" | "blocked" | "idle";
type SessionRef = { agent_session_path: string } | { agent_session_id: string };
type Request = {
  id: string;
  method: "pane.report_agent_session" | "pane.report_agent" | "pane.release_agent";
  params: Record<string, unknown>;
};
type StateReport = { state: AgentState; message?: string; seq: number };
type BlockedEvent = { active?: boolean; label?: string };
type Connect = (endpoint: string) => Socket;
type RuntimeConfig = { paneId: string; endpoint: string; connect: Connect };

let reportSeq = Date.now() * 1000;
let authority: HerdrRuntime | undefined;

function nextSeq(): number {
  reportSeq += 1;
  return reportSeq;
}

function readConfig(connect: Connect = (endpoint) => net.createConnection(endpoint)): RuntimeConfig | undefined {
  const socketPath = process.env.HERDR_SOCKET_PATH;
  const paneId = process.env.HERDR_PANE_ID;
  const depth = Number.parseInt(process.env.DIE_SUBAGENT_DEPTH ?? "0", 10) || 0;
  if (process.env.HERDR_ENV !== "1" || !socketPath || !paneId || depth !== 0) return undefined;
  return {
    paneId,
    endpoint: process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath,
    connect,
  };
}

function sessionRef(ctx: ExtensionContext): SessionRef | undefined {
  try {
    const path = ctx.sessionManager.getSessionFile();
    if (typeof path === "string" && path.startsWith("/")) return { agent_session_path: path };
  } catch {
    // An embedder's session manager can be temporarily unavailable while switching.
  }
  try {
    const id = ctx.sessionManager.getSessionId();
    if (typeof id === "string" && id.length > 0) return { agent_session_id: id };
  } catch {
    // State is still useful when no session identity is available.
  }
  return undefined;
}

class HerdrRuntime {
  private active = false;
  private agentActive = false;
  private blockedCount = 0;
  private blockedMessage: string | undefined;
  private lastState: AgentState | undefined;
  private lastMessage: string | undefined;
  private currentRef: SessionRef | undefined;
  private pendingSession: Request | undefined;
  private pendingState: StateReport | undefined;
  private pendingRelease: Request | undefined;
  private pumping = false;
  private epoch = 0;
  private sockets = new Set<Socket>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private unsubscribeBlocked: (() => void) | undefined;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly config: RuntimeConfig,
  ) {}

  register(): void {
    this.unsubscribeBlocked = this.pi.events.on("herdr:blocked", (data) => {
      if (!this.owns()) return;
      const event = typeof data === "object" && data !== null ? (data as BlockedEvent) : undefined;
      this.setBlocked(event?.active === true, event?.label);
    });
    this.pi.on("session_start", (event, ctx) => {
      if (ctx.hasUI !== true) return;
      this.claim(ctx);
      this.reportSession(event.reason);
      // Reload/new/resume can create a runtime while an existing turn is active.
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

  private owns(): boolean {
    return this.active && authority === this;
  }

  private claim(ctx: ExtensionContext): void {
    if (authority && authority !== this) authority.dispose(false);
    // A repeated session_start scopes pending work to the replacement session.
    this.epoch += 1;
    this.pendingSession = undefined;
    this.pendingState = undefined;
    this.clearTransport();
    authority = this;
    this.active = true;
    this.currentRef = sessionRef(ctx);
    this.blockedCount = 0;
    this.blockedMessage = undefined;
  }

  private setBlocked(active: boolean, label?: string): void {
    if (active) {
      this.blockedCount += 1;
      this.blockedMessage = label;
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
    this.pendingState = { state, message, seq: nextSeq() };
    this.startPump();
  }

  private reportSession(sessionStartSource?: string): void {
    if (!this.owns() || !this.currentRef) return;
    this.pendingSession = {
      id: this.id("session"),
      method: "pane.report_agent_session",
      params: {
        pane_id: this.config.paneId,
        source: SOURCE,
        agent: COMPATIBLE_AGENT,
        seq: nextSeq(),
        ...(sessionStartSource ? { session_start_source: sessionStartSource } : {}),
        ...this.currentRef,
      },
    };
    this.startPump();
  }

  private stateRequest(report: StateReport): Request {
    return {
      id: this.id("state"),
      method: "pane.report_agent",
      params: {
        pane_id: this.config.paneId,
        source: SOURCE,
        agent: COMPATIBLE_AGENT,
        state: report.state,
        ...(report.message ? { message: report.message } : {}),
        seq: report.seq,
        ...this.currentRef,
      },
    };
  }

  private releaseRequest(): Request {
    return {
      id: this.id("release"),
      method: "pane.release_agent",
      params: { pane_id: this.config.paneId, source: SOURCE, agent: COMPATIBLE_AGENT, seq: nextSeq() },
    };
  }

  private id(kind: string): string {
    return `${SOURCE}:${kind}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }

  private startPump(): void {
    if (!this.pumping) void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.active || this.pendingRelease) {
        let request = this.pendingRelease;
        if (request) this.pendingRelease = undefined;
        else if (this.pendingSession) {
          request = this.pendingSession;
          this.pendingSession = undefined;
        } else if (this.pendingState) {
          request = this.stateRequest(this.pendingState);
          this.pendingState = undefined;
        } else break;
        const epoch = this.epoch;
        await this.send(request, epoch);
      }
    } finally {
      this.pumping = false;
      if ((this.active && (this.pendingSession || this.pendingState)) || this.pendingRelease) this.startPump();
    }
  }

  private async send(request: Request, epoch: number): Promise<void> {
    if (await this.attempt(request, FIRST_TIMEOUT_MS)) return;
    const current = epoch === this.epoch;
    if (current && (this.active || request.method === "pane.release_agent")) {
      await this.attempt(request, RETRY_TIMEOUT_MS);
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
          socket.write(`${JSON.stringify(request)}\n`);
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

  private shutdown(event: SessionShutdownEvent): void {
    if (!this.owns()) {
      this.dispose(false);
      return;
    }
    this.dispose(event.reason === "quit");
  }

  dispose(release: boolean): void {
    const owned = authority === this;
    if (owned) authority = undefined;
    this.active = false;
    this.agentActive = false;
    this.pendingSession = undefined;
    this.pendingState = undefined;
    this.blockedCount = 0;
    this.blockedMessage = undefined;
    this.unsubscribeBlocked?.();
    this.unsubscribeBlocked = undefined;
    this.epoch += 1;
    this.clearTransport();
    if (release && owned) {
      this.pendingRelease = this.releaseRequest();
      this.startPump();
    }
  }
}

export function registerHerdrAgentState(pi: ExtensionAPI, connect?: Connect): void {
  const config = readConfig(connect);
  if (!config) return;
  new HerdrRuntime(pi, config).register();
}

export default registerHerdrAgentState;
