import { expect, spyOn, test } from "bun:test";
import { JobService } from "../src/tasks/job-service";
import { TaskManager } from "../src/tasks/task-manager";

const context = { cwd: process.cwd() } as any;
const signal = new AbortController().signal;

test("stopWork reports local pending and error without touching unrelated managers", async () => {
  const manager = new TaskManager(() => {});
  const unrelated = new TaskManager(() => {});
  const entries = [{ id: "local-a", status: "running" }, { id: "local-b", status: "running" }, { id: "finished", status: "cancelled" }];
  spyOn(manager, "list").mockImplementation(() => entries as any);
  const kill = spyOn(manager, "kill").mockImplementation((id) => {
    if (id === "local-b") throw new Error("stop failed");
    return { id, status: "running" } as any;
  });
  const otherKill = spyOn(unrelated, "kill");
  const service = new JobService(manager, () => ({ depth: 0 }));
  const result = await service.handle("jobs.stopWork", {}, context, signal) as any;
  expect(result).toEqual({ complete: true, jobs: [
    { id: "local-a", kind: "local", outcome: "pending", status: "running" },
    { id: "local-b", kind: "local", outcome: "error", error: "stop failed" },
  ] });
  expect(kill.mock.calls.map(([id]) => id)).toEqual(["local-a", "local-b"]);
  expect(otherKill).not.toHaveBeenCalled();
});

test("stopWork pages scoped native descendants, retains partial discovery and cancellation failures", async () => {
  const manager = new TaskManager(() => {});
  const cancelled: string[] = [];
  let failPage = false;
  const adapter = {
    list: async ({ cursor }: { cursor?: string }) => {
      if (cursor === "next") {
        if (failPage) throw new Error("list failed");
        return { tasks: [{ taskId: "child", status: "running" }, { taskId: "done", status: "completed" }], nextCursor: undefined };
      }
      return { tasks: [{ taskId: "parent", status: "running" }], nextCursor: "next" };
    },
    cancel: async (id: string) => {
      cancelled.push(id);
      if (id === "child") throw new Error("backend rejected");
      return { status: "running" };
    },
    close: async () => {},
  };
  const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined,
    { T3_MCP_URL: "http://example.invalid", T3_MCP_BEARER_TOKEN: "fake" }, () => adapter as any);
  const full = await service.handle("jobs.stopWork", {}, context, signal) as any;
  expect(full).toEqual({ complete: true, jobs: [
    { id: "parent", kind: "native", outcome: "pending", status: "running" },
    { id: "child", kind: "native", outcome: "error", error: "backend rejected" },
  ] });
  expect(cancelled).toEqual(["parent", "child"]);
  failPage = true;
  const partial = await service.handle("jobs.stopWork", {}, context, signal) as any;
  expect(partial).toMatchObject({ complete: false, discoveryError: "list failed", jobs: [
    { id: "parent", outcome: "pending" },
  ] });
});
