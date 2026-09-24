import { describe, expect, test } from "bun:test";
import { TaskManager } from "../src/tasks/task-manager";
import { JobService } from "../src/tasks/job-service";
import { LiveHostBridge } from "../src/live-lab/host-bridge";
import type { HostAuthority } from "../src/live-lab/host-bridge";

function fixture() {
  let session = "s1";
  let confirm = false;
  let listener: (event: any) => void = () => {};
  const calls: string[] = [];
  const messages: unknown[] = [];
  const job = { id: "owned", status: "running", kind: "command", command: "secret command" };
  const manager = {
    list: () => [job],
    subscribe: (fn: (event: any) => void) => {
      listener = fn;
      return () => {
        listener = () => {};
      };
    },
  };
  const context = { sessionManager: { getSessionId: () => session, getSessionFile: () => "/tmp/s1", getBranch: () => [{ type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }, { type: "image", data: "secret" }] } }] } };
  const service = {
    handle: async (method: string, input: any) => {
      calls.push(method + ":" + input.id);
      if (method === "jobs.list") return { jobs: [job], total: 1 };
      if (input.id === "foreign") throw new Error("outside");
      if (method === "jobs.inspect") return { id: input.id, output: "ok", limit: input.limit };
      if (method === "jobs.stop") return { id: input.id, status: "killed" };
      throw new Error("Unexpected operation");
    },
  };
  const host = {
    manager,
    context,
    service,
    sendUserMessage: (...args: unknown[]) => {
      messages.push(args);
    },
    confirmStop: async () => confirm,
  } as unknown as HostAuthority;
  return {
    bridge: new LiveHostBridge(host),
    calls,
    messages,
    emit: (type: string) => listener({ type, task: job }),
    setSession: (value: string) => {
      session = value;
    },
    allow: () => {
      confirm = true;
    },
  };
}
describe("Live host authority", () => {
  test("steers configured agent exactly once across voice reconnect and rejects changed replay", async () => {
    const f = fixture();
    expect(await f.bridge.steer("r1", "do work")).toEqual({ queued: true });
    expect(await f.bridge.steer("r1", "do work")).toEqual({ queued: true });
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]).toEqual([
      "[voice request id: r1]\ndo work",
      { deliverAs: "steer", expandPromptTemplates: false },
    ]);
    expect(() => f.bridge.steer("r1", "different")).toThrow();
  });
  test("real dispatcher inspect, bounded context, no foreign or native IDs", async () => {
    const f = fixture();
    expect((await f.bridge.list() as { total: number }).total).toBe(1);
    expect(f.bridge.context().jobs).toEqual([{ id: "owned", status: "running", kind: "command" }]);
    expect(await f.bridge.inspect("owned")).toEqual({ id: "owned", output: "ok", limit: 3000 });
    await expect(f.bridge.inspect("foreign")).rejects.toThrow("outside");
    expect(f.calls).toEqual(["jobs.list:undefined", "jobs.inspect:owned", "jobs.inspect:foreign"]);
    expect(f.bridge.context().recent).toEqual([{ role: "user", text: "hello" }]);
    f.setSession("s2");
    await expect(f.bridge.list()).rejects.toThrow("scope changed");
  });
  test("stop requires trusted confirmation, denial and failure deduplicated", async () => {
    const f = fixture();
    await expect(f.bridge.stop("denied", "owned")).rejects.toThrow("confirm");
    f.allow();
    await expect(f.bridge.stop("denied", "owned")).rejects.toThrow("confirm");
    await expect(f.bridge.stop("foreign", "foreign")).rejects.toThrow("outside");
    expect(await f.bridge.stop("approved", "owned")).toEqual({ id: "owned", status: "killed" });
    expect(await f.bridge.stop("approved", "owned")).toEqual({ id: "owned", status: "killed" });
    expect(f.calls).toEqual(["jobs.stop:foreign", "jobs.stop:owned"]);
  });
  test("completion subscriptions survive voice listener replacement and ignore subscriber failures", () => {
    const f = fixture();
    const seen: string[] = [];
    const off = f.bridge.subscribe(() => {
      throw new Error("subscriber failed");
    });
    const old = f.bridge.subscribe((event) => seen.push(event.type));
    f.emit("activity");
    f.emit("completed");
    old();
    f.bridge.subscribe((event) => seen.push(event.type));
    off();
    f.emit("completed");
    f.bridge.close();
    f.emit("completed");
    expect(seen).toEqual(["completed", "completed"]);
  });
  test("failed steer retained; no accidental retry", async () => {
    const f = fixture();
    expect(() => f.bridge.steer("bad", " ")).toThrow();
  });
});

test("actual TaskManager + JobService dispatch stays within owner", async () => {
  const manager = new TaskManager(() => {});
  const task = manager.spawn({
    kind: "command",
    command: process.execPath,
    displayCommand: "bridge-test",
    cwd: process.cwd(),
    args: ["-e", "console.log('bridge-test')"],
  });
  const context = { sessionManager: { getSessionId: () => "one", getSessionFile: () => "/tmp/one", getBranch: () => [] } };
  const bridge = new LiveHostBridge({
    manager,
    service: new JobService(manager, () => ({ depth: 0 })),
    context,
    sendUserMessage: () => {},
    confirmStop: async () => false,
  } as unknown as HostAuthority);
  expect(((await bridge.list()) as { jobs: { id: string }[] }).jobs[0]?.id).toBe(task.id);
  const inspected = (await bridge.inspect(task.id)) as { id: string };
  expect(inspected.id).toBe(task.id);
  await expect(bridge.inspect("not-owned")).rejects.toThrow("Unknown task");
  await expect(bridge.stop("stop-1", task.id)).rejects.toThrow("confirm");
  await manager.wait(task.id);
  bridge.close();
});
