import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JobService } from "../tasks/job-service";
import type { TaskManager, TaskEvent } from "../tasks/task-manager";

/** This authority must come from the owning tasks extension, never a second scheduler. */
export interface HostAuthority {
  service: Pick<JobService, "handle">;
  manager: Pick<TaskManager, "list" | "subscribe">;
  context: ExtensionContext;
  sendUserMessage(text: string, options: { deliverAs: "steer" | "followUp"; expandPromptTemplates: false }): void;
  confirmStop(id: string): Promise<boolean>;
}
export type HostUpdate = { type: "spawned" | "updated" | "completed" | "stopping" | "assistant" | "turn_end"; id?: string; status?: string; text?: string };
const MAX_REQUESTS = 256;
const MAX_TEXT = 4000;

export class LiveHostBridge {
  private readonly requests = new Map<string, { hash: string; result: Promise<unknown>; operation: string; state: "pending" | "done" | "failed" }>();
  private readonly listeners = new Set<(update: HostUpdate) => void>();
  private readonly unsubscribe: () => void;
  private readonly owner: object;
  private readonly sessionId: string | undefined;
  private readonly sessionFile: string | undefined;
  private closed = false;
  constructor(private readonly host: HostAuthority) {
    this.owner = host.context.sessionManager;
    this.sessionId = host.context.sessionManager.getSessionId();
    this.sessionFile = host.context.sessionManager.getSessionFile();
    this.unsubscribe = host.manager.subscribe((event: TaskEvent) => {
      if (event.type === "activity" || !this.active()) return;
      this.observe({ type: event.type, id: event.task.id, status: event.task.status });
    });
  }
  observe(update: HostUpdate): void {
    if (!this.active()) return;
    for (const listener of this.listeners) {
      try { listener(update); } catch { /* Subscriber failure cannot interrupt host events. */ }
    }
  }
  private active(): boolean {
    const manager = this.host.context.sessionManager;
    return !this.closed && manager === this.owner && manager.getSessionId() === this.sessionId && manager.getSessionFile() === this.sessionFile;
  }
  private assertActive(): void { if (!this.active()) throw new Error("Host session scope changed"); }
  private once<T>(id: string, operation: string, input: unknown, run: () => Promise<T>): Promise<T> {
    this.assertActive();
    if (!id || id.length > 128) throw new Error("Invalid request ID");
    const hash = createHash("sha256").update(JSON.stringify([operation, input])).digest("hex");
    const existing = this.requests.get(id);
    if (existing) {
      if (existing.hash !== hash) throw new Error("Request ID reused with different content");
      return existing.result as Promise<T>;
    }
    if (this.requests.size >= MAX_REQUESTS) throw new Error("Voice request capacity reached; reconnect will not reset it");
    const entry: { hash: string; result: Promise<T>; operation: string; state: "pending" | "done" | "failed" } = { hash, operation, state: "pending", result: undefined! };
    entry.result = Promise.resolve().then(() => { this.assertActive(); return run(); }).then(value => { entry.state = "done"; return value; }, error => { entry.state = "failed"; throw error; });
    this.requests.set(id, entry);
    return entry.result;
  }
  private queue(requestId: string, text: string, deliverAs: "steer" | "followUp"): Promise<{ queued: true }> {
    if (!text.trim() || text.length > MAX_TEXT) throw new Error("Invalid host message text");
    return this.once(requestId, deliverAs, text, async () => {
      this.host.sendUserMessage(`[voice request id: ${requestId}]\n${text}`, { deliverAs, expandPromptTemplates: false });
      return { queued: true } as const;
    });
  }
  steer(requestId: string, text: string): Promise<{ queued: true }> { return this.queue(requestId, text, "steer"); }
  send(requestId: string, text: string): Promise<{ queued: true }> { return this.queue(requestId, text, "followUp"); }
  async list(params: { cursor?: number | string; count?: number } = {}, signal: AbortSignal = new AbortController().signal): Promise<unknown> {
    this.assertActive();
    return this.host.service.handle("jobs.list", params, this.host.context, signal);
  }
  async inspect(id: string, offset?: number, signal: AbortSignal = new AbortController().signal): Promise<unknown> {
    this.assertActive();
    return this.host.service.handle("jobs.inspect", { id, ...(offset === undefined ? {} : { offset }), limit: 3000 }, this.host.context, signal);
  }
  stop(requestId: string, id: string, signal: AbortSignal = new AbortController().signal): Promise<unknown> {
    return this.once(requestId, "stop", id, async () => {
      if (!(await this.host.confirmStop(id))) throw new Error("User did not confirm cancellation");
      this.assertActive();
      return this.host.service.handle("jobs.stop", { id }, this.host.context, signal);
    });
  }
  context(): { sessionId?: string; jobs: { id: string; status: string; kind: string }[]; recent: { role: "user" | "assistant"; text: string }[]; requests: { id: string; operation: string; state: "pending" | "done" | "failed" }[]; nativeUpdates: string } {
    this.assertActive();
    const entries = this.host.context.sessionManager.getBranch();
    const recent: { role: "user" | "assistant"; text: string }[] = [];
    for (const entry of entries.slice(-80)) {
      if (entry.type !== "message" || !entry.message || (entry.message.role !== "user" && entry.message.role !== "assistant")) continue;
      const parts = entry.message.content;
      if (typeof parts === "string") { recent.push({ role: entry.message.role, text: parts.slice(0, 1000) }); continue; }
      if (!Array.isArray(parts)) continue;
      const text = parts.filter((part) => part.type === "text").map((part) => part.text).join(" ").slice(0, 1000);
      if (text) recent.push({ role: entry.message.role, text });
    }
    return {
      sessionId: this.sessionId?.slice(0, 128),
      jobs: this.host.manager.list().slice(0, 50).map(({ id, status, kind }) => ({ id, status, kind })),
      recent: recent.slice(-12),
      requests: [...this.requests].map(([id, entry]) => ({ id, operation: entry.operation, state: entry.state })),
      nativeUpdates: "Native job events are not available in the local TUI; use list/inspect to refresh.",
    };
  }
  subscribe(listener: (update: HostUpdate) => void): () => void { this.assertActive(); this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  close(): void { this.closed = true; this.unsubscribe(); this.listeners.clear(); this.requests.clear(); }
}
