import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { type T3BridgeEnvironment, T3McpClient } from "./mcp-client";

export type T3LocalNotificationKind = "completion" | "attention";
export interface T3LocalNotification {
  readonly version: 1;
  readonly notificationId: string;
  readonly taskId: string;
  readonly kind: T3LocalNotificationKind;
  readonly text: string;
  readonly createdAt: string;
}

const MAX_RECORDS = 64;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 5_000;

function validRecord(value: unknown): value is T3LocalNotification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    row.version === 1 &&
    typeof row.notificationId === "string" &&
    row.notificationId.length > 0 &&
    row.notificationId.length <= 128 &&
    typeof row.taskId === "string" &&
    row.taskId.length > 0 &&
    row.taskId.length <= 200 &&
    (row.kind === "completion" || row.kind === "attention") &&
    typeof row.text === "string" &&
    row.text.length <= MAX_TEXT_CHARS &&
    typeof row.createdAt === "string"
  );
}

/** Crash-safe, session-affine mailbox. A row is removed only after server ACK. */
export class T3LocalNotificationOutbox {
  readonly path: string;
  #records: T3LocalNotification[];

  constructor(sessionFile: string) {
    this.path = sessionFile + ".t3-local-notifications-v1.json";
    // A crash before rename can leave only this bounded staging file. The main
    // mailbox remains authoritative until rename has durably completed.
    try {
      unlinkSync(this.path + ".tmp");
    } catch {}
    this.#records = this.#read();
  }

  #read(): T3LocalNotification[] {
    try {
      const bytes = readFileSync(this.path);
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("T3 local notification outbox exceeds its bound");
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!Array.isArray(parsed) || parsed.length > MAX_RECORDS || !parsed.every(validRecord))
        throw new Error("Invalid T3 local notification outbox");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  list(): readonly T3LocalNotification[] {
    this.#records = this.#read();
    return this.#records.slice();
  }

  assertLaunchCapacity(runningTasks: number): void {
    // Reserve one terminal record per live job before any child is spawned.
    // 64 worst-case JSON-escaped records fit beneath the 4 MiB file bound.
    if (runningTasks >= 50 || this.list().length + runningTasks >= MAX_RECORDS)
      throw new Error("T3 local job delivery capacity is exhausted; wait for pending delivery");
  }

  add(input: { taskId: string; kind: T3LocalNotificationKind; text: string }): T3LocalNotification {
    this.#records = this.#read();
    const text = input.text.slice(0, MAX_TEXT_CHARS);
    const previous = this.#records.find((row) => row.taskId === input.taskId && row.kind === "completion");
    if (previous) return previous;
    // Attention is a checkpoint, not an append-only event. Keep only the newest
    // checkpoint and let a terminal completion supersede it before persistence.
    const retained = this.#records.filter(
      (row) => row.taskId !== input.taskId || (row.kind === "completion" && input.kind === "attention"),
    );
    const existingCompletion = retained.find((row) => row.taskId === input.taskId && row.kind === "completion");
    if (input.kind === "attention" && existingCompletion) return existingCompletion;
    if (retained.length >= MAX_RECORDS) throw new Error("T3 local notification outbox is full");
    const record: T3LocalNotification = {
      version: 1,
      notificationId:
        input.kind === "completion"
          ? "completion:" + createHash("sha256").update(input.taskId).digest("hex")
          : randomUUID(),
      taskId: input.taskId.slice(0, 200),
      kind: input.kind,
      text,
      createdAt: new Date().toISOString(),
    };
    this.#commit([...retained, record]);
    return record;
  }

  acknowledge(notificationId: string): void {
    this.#records = this.#read();
    const next = this.#records.filter((row) => row.notificationId !== notificationId);
    if (next.length === this.#records.length) return;
    this.#commit(next);
  }

  #commit(records: T3LocalNotification[]): void {
    const data = JSON.stringify(records);
    if (Buffer.byteLength(data) > MAX_FILE_BYTES) throw new Error("T3 local notification outbox is full");
    const temporary = this.path + ".tmp";
    let fd: number | undefined;
    try {
      writeFileSync(temporary, data, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fd = openSync(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, this.path);
      const directory = openSync(dirname(this.path), constants.O_RDONLY);
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
      this.#records = records;
    } finally {
      if (fd !== undefined) closeSync(fd);
      try {
        unlinkSync(temporary);
      } catch {}
    }
  }
}

export class T3LocalNotificationDelivery {
  #stopped = false;
  #running?: Promise<void>;
  #retry?: ReturnType<typeof setTimeout>;
  #retryDelay = 1_000;
  #client?: T3McpClient;
  #pauseTimer?: ReturnType<typeof setTimeout>;
  #resume?: () => void;

  constructor(
    readonly outbox: T3LocalNotificationOutbox,
    private readonly bridge: Extract<T3BridgeEnvironment, { kind: "remote" }>,
    private readonly clientFactory = (url: string, token: string) => new T3McpClient(url, token, 5_000),
  ) {}

  enqueue(input: { taskId: string; kind: T3LocalNotificationKind; text: string }): void {
    this.outbox.add(input); // durable before asynchronous admission
    this.start();
  }

  start(): void {
    if (this.#stopped || this.#running) return;
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = undefined;
    this.#running = this.#drain().finally(() => {
      this.#running = undefined;
      if (!this.#stopped && this.outbox.list().length > 0) {
        // One bounded timer retries durable pending work after a transient
        // outage even if the model is idle. Never require another user turn.
        this.#retry = setTimeout(() => this.start(), this.#retryDelay);
        this.#retry.unref();
        this.#retryDelay = Math.min(30_000, this.#retryDelay * 2);
      }
    });
    void this.#running.catch(() => undefined);
  }

  async flush(): Promise<void> {
    this.start();
    await this.#running;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = undefined;
    if (this.#pauseTimer) clearTimeout(this.#pauseTimer);
    this.#pauseTimer = undefined;
    this.#resume?.();
    this.#resume = undefined;
    await this.#client?.close().catch(() => undefined);
    await this.#running?.catch(() => undefined);
  }

  async #pause(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#resume = resolve;
      this.#pauseTimer = setTimeout(resolve, ms);
    });
    this.#pauseTimer = undefined;
    this.#resume = undefined;
  }

  async #drain(): Promise<void> {
    const attempted = new Set<string>();
    for (let count = 0; count < MAX_RECORDS; count++) {
      const pending = this.outbox.list().filter((row) => !attempted.has(row.notificationId));
      const row = pending.find((row) => row.kind === "completion") ?? pending[0];
      if (!row) return;
      attempted.add(row.notificationId);
      if (this.#stopped) return;
      let acknowledged = false;
      const retryDelays = [0, 20, 100, 250, 500] as const;
      for (let attempt = 0; attempt < retryDelays.length && !acknowledged && !this.#stopped; attempt++) {
        if (!this.outbox.list().some((current) => current.notificationId === row.notificationId)) break;
        if (retryDelays[attempt] > 0) await this.#pause(retryDelays[attempt]);
        if (this.#stopped) return;
        const client = this.clientFactory(this.bridge.url, this.bridge.token);
        this.#client = client;
        try {
          const result = await client.callTool("die_local_job_notify", {
            version: 1,
            notificationId: row.notificationId,
            taskId: row.taskId,
            kind: row.kind,
            text: row.text,
          });
          const value = result.structuredContent;
          acknowledged =
            !result.isError &&
            !!value &&
            typeof value === "object" &&
            (value as { notificationId?: unknown }).notificationId === row.notificationId &&
            ((value as { state?: unknown }).state === "committed" ||
              (value as { state?: unknown }).state === "disposed");
        } catch {
          // Ambiguous responses replay the stable command/message identity.
        } finally {
          await client.close().catch(() => undefined);
          if (this.#client === client) this.#client = undefined;
        }
      }
      if (!acknowledged) {
        if (!this.outbox.list().some((current) => current.notificationId === row.notificationId)) continue;
        // A rejected/stale row must not starve another task’s terminal output.
        // Keep it durable for the next bounded retry pass.
        continue;
      }
      this.outbox.acknowledge(row.notificationId);
      this.#retryDelay = 1_000;
    }
  }
}
