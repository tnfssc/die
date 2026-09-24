import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JobService } from "../tasks/job-service.js";
import type { TaskEvent, TaskManager } from "../tasks/task-manager.js";

/** The owning tasks extension supplies its existing service and manager. Never construct a second scheduler. */
export interface HostAuthority {
  service: Pick<JobService, "handle">;
  manager: Pick<TaskManager, "list" | "subscribe">;
  context: ExtensionContext;
  sendMessage(
    message: { customType: string; content: string; display: boolean },
    options: { deliverAs: "steer"; triggerTurn: true },
  ): void;
  /** Trusted UI gesture. A voice-model argument must never implement this callback. */
  confirmStop(id: string): Promise<boolean>;
}
export type HostUpdate = { type: "spawned" | "updated" | "completed" | "stopping"; id: string; status: string };
const MAX_REQUESTS = 256;
const MAX_TEXT = 4000;

/** Extension-lifetime bridge: keep across voice connection replacements, dispose only on extension shutdown. */
export class LiveHostBridge {
  private readonly requests = new Map<string, { hash: string; result: Promise<unknown> }>();
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
      if (event.type === "activity" || !this.active() || !this.owns(event.task.id)) return;
      const update: HostUpdate = { type: event.type, id: event.task.id, status: event.task.status };
      for (const listener of this.listeners) {
        try {
          listener(update);
        } catch {
          /* Subscriber failure cannot break task ownership. */
        }
      }
    });
  }
  private active(): boolean {
    const manager = this.host.context.sessionManager;
    return (
      !this.closed &&
      manager === this.owner &&
      manager.getSessionId() === this.sessionId &&
      manager.getSessionFile() === this.sessionFile
    );
  }
  private assertActive(): void {
    if (!this.active()) throw new Error("Host session scope changed");
  }
  private owns(id: string): boolean {
    return this.host.manager.list().some((job) => job.id === id);
  }
  private once<T>(id: string, operation: string, input: unknown, run: () => Promise<T>): Promise<T> {
    this.assertActive();
    if (!id || id.length > 128) throw new Error("Invalid request ID");
    const hash = createHash("sha256")
      .update(JSON.stringify([operation, input]))
      .digest("hex");
    const existing = this.requests.get(id);
    if (existing) {
      if (existing.hash !== hash) throw new Error("Request ID reused with different content");
      return existing.result as Promise<T>;
    }
    if (this.requests.size >= MAX_REQUESTS)
      throw new Error("Voice request capacity reached; reconnect will not reset it");
    const result = Promise.resolve().then(() => {
      this.assertActive();
      return run();
    });
    this.requests.set(id, { hash, result }); // Retain failures too: an ambiguous mutation must not replay.
    return result;
  }
  /** Steer the configured host agent, not Gemini; does not start or stop voice. */
  steer(requestId: string, text: string): Promise<{ accepted: true }> {
    if (!text.trim() || text.length > MAX_TEXT) throw new Error("Invalid steer text");
    return this.once(requestId, "steer", text, async () => {
      this.host.sendMessage(
        { customType: "live-host-steer", content: text, display: true },
        { deliverAs: "steer", triggerTurn: true },
      );
      return { accepted: true };
    });
  }
  /** Only session-owned local jobs are exposed. Native IDs need a separately verified scoped authority. */
  list(): { jobs: { id: string; kind: string; status: string; startedAt: string }[]; total: number } {
    this.assertActive();
    const jobs = this.host.manager
      .list()
      .slice(0, 100)
      .map(({ id, kind, status, startedAt }) => ({ id, kind, status, startedAt }));
    return { jobs, total: this.host.manager.list().length };
  }
  async inspect(id: string, signal: AbortSignal = new AbortController().signal): Promise<unknown> {
    this.assertActive();
    if (!this.owns(id)) throw new Error("Job outside current host session");
    return this.host.service.handle("jobs.inspect", { id, limit: 3000 }, this.host.context, signal);
  }
  /** No cancellation via model booleans. Explicit trusted UI confirmation is required for every stop request. */
  stop(requestId: string, id: string, signal: AbortSignal = new AbortController().signal): Promise<unknown> {
    return this.once(requestId, "stop", id, async () => {
      if (!this.owns(id)) throw new Error("Job outside current host session");
      if (!(await this.host.confirmStop(id))) throw new Error("User did not confirm cancellation");
      this.assertActive();
      if (!this.owns(id)) throw new Error("Job outside current host session");
      return this.host.service.handle("jobs.stop", { id }, this.host.context, signal);
    });
  }
  /** Bounded metadata only; no transcript, tool output, credentials or historical session files. */
  context(): { sessionId?: string; sessionFile?: string; jobs: { id: string; status: string; kind: string }[] } {
    this.assertActive();
    return {
      sessionId: this.sessionId?.slice(0, 128),
      sessionFile: this.sessionFile?.slice(0, 512),
      jobs: this.host.manager
        .list()
        .slice(0, 50)
        .map(({ id, status, kind }) => ({ id: id.slice(0, 128), status, kind })),
    };
  }
  subscribe(listener: (update: HostUpdate) => void): () => void {
    this.assertActive();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  close(): void {
    this.closed = true;
    this.unsubscribe();
    this.listeners.clear();
    this.requests.clear();
  }
}
