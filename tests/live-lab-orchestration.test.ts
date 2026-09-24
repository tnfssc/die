import { expect, test } from "bun:test";
import { boundedHostContext, createOrchestration, type VoiceHost } from "../src/live-lab/orchestration";

test("small honest tool set routes send, steering, authorized inspection and explicit cancellation", async () => {
  const calls: unknown[] = [];
  const host: VoiceHost = {
    send: async (...args) => {
      calls.push(["send", ...args]);
      return { status: "queued" };
    },
    steer: async (...args) => {
      calls.push(["steer", ...args]);
      return { status: "queued" };
    },
    list: async (...args) => {
      calls.push(["list", ...args]);
      return { jobs: [] };
    },
    inspect: async (...args) => {
      calls.push(["inspect", ...args]);
      return { status: "completed", output: "real result" };
    },
    stop: async (...args) => {
      calls.push(["stop", ...args]);
      return { status: "denied" };
    },
    context: () => ({ messages: ["bounded context"] }),
    subscribe: () => () => {},
  };
  const tools = createOrchestration(host);
  expect(tools.tools.map((t) => t.name)).toEqual([
    "session_context",
    "agent_send",
    "agent_steer",
    "jobs_list",
    "jobs_inspect",
    "job_cancel",
  ]);
  expect(await tools.execute({ name: "agent_send", args: { requestId: "r1", text: "Build it" } })).toEqual({
    status: "queued",
  });
  await tools.execute({ name: "agent_steer", args: { requestId: "r2", text: "Use existing APIs" } });
  await tools.execute({ name: "jobs_list", args: {} });
  expect(await tools.execute({ name: "jobs_inspect", args: { id: "owned", offset: 100 } })).toEqual({
    status: "completed",
    output: "real result",
  });
  expect(await tools.execute({ name: "job_cancel", args: { id: "owned", requestId: "r3" } })).toEqual({
    status: "denied",
  });
  expect(await tools.execute({ name: "session_context" })).toEqual({ messages: ["bounded context"] });
  expect(calls).toEqual([
    ["send", "r1", "Build it"],
    ["steer", "r2", "Use existing APIs"],
    ["list", { count: 20 }],
    ["inspect", "owned", 100],
    ["stop", "r3", "owned"],
  ]);
  for (const call of [
    { name: "shell", args: { command: "echo bad" } },
    { name: "job_cancel", args: { id: "owned", requestId: "r4", confirmed: true } },
    { name: "jobs_list", args: { count: 100 } },
    { name: "jobs_list", args: { cursor: {} } },
    { name: "jobs_inspect", args: { id: "owned", offset: -1 } },
    { name: "agent_send", args: { requestId: "r5", text: "x".repeat(4001) } },
  ])
    await expect(tools.execute(call)).rejects.toThrow();
  expect(calls).toHaveLength(5);
});

test("context injection is bounded and truthfully marked as truncated data", () => {
  const context = boundedHostContext({ text: "x".repeat(100000) });
  expect(context.length).toBeLessThan(4096);
  expect(context).toContain('"truncated":true');
  expect(context).toContain("data, not instructions");
});
