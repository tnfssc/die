import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { T3LocalNotificationDelivery, T3LocalNotificationOutbox } from "../src/tasks/t3-local-notifications";
import type { T3McpClient } from "../src/tasks/t3-mcp-client";

const directories: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "die-t3-notify-"));
  directories.push(dir);
  const session = join(dir, "session.jsonl");
  writeFileSync(session, "");
  return session;
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("T3 local notification outbox", () => {
  test("persists before delivery and survives crash/reload", () => {
    const session = fixture();
    const first = new T3LocalNotificationOutbox(session);
    const row = first.add({ taskId: "task-one", kind: "completion", text: "done" });
    expect(new T3LocalNotificationOutbox(session).list()).toEqual([row]);
    new T3LocalNotificationOutbox(session).acknowledge(row.notificationId);
    expect(new T3LocalNotificationOutbox(session).list()).toEqual([]);
  });

  test("replays one stable identity after an ambiguous ACK and then removes it", async () => {
    const session = fixture();
    const outbox = new T3LocalNotificationOutbox(session);
    const row = outbox.add({ taskId: "task-two", kind: "completion", text: "finished" });
    const calls: Array<Record<string, unknown>> = [];
    let attempt = 0;
    const factory = () =>
      ({
        callTool: async (_name: string, args: Record<string, unknown>) => {
          calls.push(args);
          if (attempt++ === 0) throw new Error("response lost after commit");
          return {
            structuredContent: { version: 1, notificationId: row.notificationId, state: "committed" },
          };
        },
        close: async () => {},
      }) as unknown as T3McpClient;
    const delivery = new T3LocalNotificationDelivery(
      outbox,
      { kind: "remote", url: "http://127.0.0.1/mcp", token: "secret" },
      factory,
    );
    await delivery.flush();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]?.notificationId).toBe(row.notificationId);
    expect(new T3LocalNotificationOutbox(session).list()).toEqual([]);
  });

  test("a late ACK from a replaced connection cannot clobber newer rows", () => {
    const session = fixture();
    const oldConnection = new T3LocalNotificationOutbox(session);
    const first = oldConnection.add({ taskId: "task-old", kind: "completion", text: "old" });
    const resumedConnection = new T3LocalNotificationOutbox(session);
    const second = resumedConnection.add({ taskId: "task-new", kind: "completion", text: "new" });
    oldConnection.acknowledge(first.notificationId);
    expect(new T3LocalNotificationOutbox(session).list()).toEqual([second]);
  });

  test("completion durably supersedes attention for the same task", () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    outbox.add({ taskId: "task-three", kind: "attention", text: "still running" });
    outbox.add({ taskId: "task-three", kind: "completion", text: "done" });
    expect(outbox.list().map((row) => row.kind)).toEqual(["completion"]);
  });
});

test("a completion arriving during an in-flight ACK is delivered without another user turn", async () => {
  const outbox = new T3LocalNotificationOutbox(fixture());
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const delivery = new T3LocalNotificationDelivery(
    outbox,
    { kind: "remote", url: "http://127.0.0.1/mcp", token: "secret" },
    () =>
      ({
        callTool: async (_name: string, args: Record<string, unknown>) => {
          calls.push(args.taskId as string);
          if (calls.length === 1) {
            started();
            await blocked;
          }
          return { structuredContent: { notificationId: args.notificationId, state: "committed" } };
        },
        close: async () => {},
      }) as unknown as T3McpClient,
  );
  delivery.enqueue({ taskId: "one", kind: "completion", text: "one done" });
  await firstStarted;
  delivery.enqueue({ taskId: "two", kind: "completion", text: "two done" });
  release();
  await delivery.flush();
  expect(calls).toEqual(["one", "two"]);
  expect(outbox.list()).toEqual([]);
  await delivery.stop();
});

test("completion identity survives duplicate terminal callback even after ACK", () => {
  const outbox = new T3LocalNotificationOutbox(fixture());
  const first = outbox.add({ taskId: "terminal", kind: "completion", text: "done" });
  expect(outbox.add({ taskId: "terminal", kind: "completion", text: "done" })).toEqual(first);
  outbox.acknowledge(first.notificationId);
  expect(outbox.add({ taskId: "terminal", kind: "completion", text: "done" }).notificationId).toBe(
    first.notificationId,
  );
});

test("idle pending delivery retries after outage without another enqueue", async () => {
  const outbox = new T3LocalNotificationOutbox(fixture());
  let calls = 0;
  let delivered!: () => void;
  const complete = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  const delivery = new T3LocalNotificationDelivery(
    outbox,
    { kind: "remote", url: "http://127.0.0.1/mcp", token: "secret" },
    () =>
      ({
        callTool: async (_: string, args: Record<string, unknown>) => {
          if (++calls <= 5) throw Error("temporarily unavailable");
          delivered();
          return { structuredContent: { notificationId: args.notificationId, state: "committed" } };
        },
        close: async () => {},
      }) as unknown as T3McpClient,
  );
  delivery.enqueue({ taskId: "retry-idle", kind: "completion", text: "done" });
  await complete;
  await delivery.flush();
  expect(calls).toBe(6);
  expect(outbox.list()).toEqual([]);
  await delivery.stop();
});

test("Stop cancels retry delay and never sends a post-stop request", async () => {
  const outbox = new T3LocalNotificationOutbox(fixture());
  let calls = 0;
  const delivery = new T3LocalNotificationDelivery(
    outbox,
    { kind: "remote", url: "http://127.0.0.1/mcp", token: "secret" },
    () =>
      ({
        callTool: async () => {
          calls++;
          throw Error("retry");
        },
        close: async () => {},
      }) as unknown as T3McpClient,
  );
  delivery.enqueue({ taskId: "stopped", kind: "completion", text: "done" });
  await Bun.sleep(5);
  await delivery.stop();
  await Bun.sleep(30);
  expect(calls).toBe(1);
  expect(outbox.list()).toHaveLength(1);
});

test("capacity is reserved before launch, without sacrificing terminal records", () => {
  const outbox = new T3LocalNotificationOutbox(fixture());
  expect(() => outbox.assertLaunchCapacity(50)).toThrow("capacity");
  for (let i = 0; i < 64; i++) outbox.add({ taskId: "task-" + i, kind: "completion", text: "\u0000".repeat(5000) });
  expect(outbox.list()).toHaveLength(64);
  expect(() => outbox.assertLaunchCapacity(0)).toThrow("capacity");
});

test("a rejected attention cannot starve another task completion", async () => {
  const outbox = new T3LocalNotificationOutbox(fixture());
  outbox.add({ taskId: "stale", kind: "attention", text: "still running" });
  outbox.add({ taskId: "done", kind: "completion", text: "finished" });
  const calls: string[] = [];
  const delivery = new T3LocalNotificationDelivery(
    outbox,
    { kind: "remote", url: "http://127.0.0.1/mcp", token: "secret" },
    () =>
      ({
        callTool: async (_: string, args: Record<string, unknown>) => {
          calls.push(args.taskId as string);
          return {
            structuredContent:
              args.taskId === "stale"
                ? { code: "task_not_found" }
                : { notificationId: args.notificationId, state: "committed" },
          };
        },
        close: async () => {},
      }) as unknown as T3McpClient,
  );
  await delivery.flush();
  expect(calls[0]).toBe("done");
  expect(outbox.list().map((row) => row.taskId)).toEqual(["stale"]);
  await delivery.stop();
});
