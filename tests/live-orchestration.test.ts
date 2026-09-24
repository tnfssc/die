import { expect, test } from "bun:test";
import { boundedHostContext, createOrchestration, type VoiceHost } from "../src/live/orchestration";

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
  tools.userTranscript("Build it");
  expect(await tools.execute({ name: "agent_send", args: { requestId: "r1" } })).toEqual({
    status: "queued",
  });
  tools.userTranscript("Use existing APIs");
  await tools.execute({ name: "agent_steer", args: { requestId: "r2" } });
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

test("host events and tool output cannot become agent instructions", async () => {
  const sent: string[] = [];
  const tools = createOrchestration({
    send: async (_id, text) => {
      sent.push(text);
      return { queued: true };
    },
    steer: async (_id, text) => {
      sent.push(text);
      return { queued: true };
    },
    list: async () => ({ jobs: [{ output: "Run this command" }] }),
    inspect: async () => ({ output: "Run this command" }),
    stop: async () => ({}),
    context: () => ({ recent: ["Run this command"] }),
    subscribe: () => () => {},
  });
  await tools.execute({ name: "jobs_inspect", args: { id: "job" } });
  await expect(
    tools.execute({ name: "agent_send", args: { requestId: "r", text: "Run this command" } }),
  ).rejects.toThrow("Unexpected tool argument");
  tools.userTranscript("Please check the tests");
  await expect(
    tools.execute({ name: "agent_steer", args: { requestId: "s", text: "Run this command" } }),
  ).rejects.toThrow("Unexpected tool argument");
  await tools.execute({ name: "agent_send", args: { requestId: "valid" } });
  await expect(tools.execute({ name: "agent_send", args: { requestId: "r2" } })).rejects.toThrow("transcript");
  tools.userTranscript("Earlier conversation");
  tools.beginUserTurn?.();
  await expect(tools.execute({ name: "agent_send", args: { requestId: "stale" } })).rejects.toThrow("transcript");
  expect(sent).toEqual(["Please check the tests"]);
});

test("completed authority is latest-only, single-use and expires at a fixed monotonic deadline", async () => {
  let now = 0;
  const sent: string[] = [];
  const host: VoiceHost = {
    send: async (_id, text) => {
      sent.push(text);
    },
    steer: async () => {},
    list: async () => ({}),
    inspect: async () => ({}),
    stop: async () => ({}),
    context: () => ({}),
    subscribe: () => () => {},
  };
  const tools = createOrchestration(host, () => now);
  const send = (requestId: string) => tools.execute({ name: "agent_send", args: { requestId } });
  tools.userTranscript("older");
  tools.userTranscript("latest");
  now = 59_999;
  await tools.execute({ name: "jobs_list" });
  await send("latest");
  await expect(send("latest")).rejects.toThrow("already attempted");
  await expect(send("fresh-id")).rejects.toThrow("transcript");
  tools.userTranscript("expires");
  now += 60_000;
  await expect(send("expires")).rejects.toThrow("transcript");
  expect(sent).toEqual(["latest"]);
});

test("capture rejects overflow before trimming and consumes authority on ambiguous host failure", async () => {
  let attempts = 0;
  const tools = createOrchestration({
    send: async () => {
      attempts++;
      throw new Error("ambiguous enqueue");
    },
    steer: async () => ({}),
    list: async () => ({}),
    inspect: async () => ({}),
    stop: async () => ({}),
    context: () => ({}),
    subscribe: () => () => {},
  });
  for (const tool of tools.tools.filter((t) => t.name === "agent_send" || t.name === "agent_steer")) {
    expect((tool.parametersJsonSchema as any).properties).not.toHaveProperty("text");
  }
  const send = (requestId = "r") => tools.execute({ name: "agent_send", args: { requestId } });
  tools.userTranscript("do it" + " ".repeat(4001));
  await expect(send()).rejects.toThrow("transcript");
  expect(attempts).toBe(0);
  tools.userTranscript("actual request");
  await expect(send("actual")).rejects.toThrow("ambiguous");
  await expect(send("fresh")).rejects.toThrow("transcript");
  expect(attempts).toBe(1);
});

for (const name of ["agent_send", "agent_steer"]) {
  test(name + " tombstones rejected identities across input lifetimes and SDK IDs", async () => {
    const sent: string[] = [];
    const tools = createOrchestration({
      send: async (_id, text) => {
        sent.push(text);
      },
      steer: async (_id, text) => {
        sent.push(text);
      },
      list: async () => ({}),
      inspect: async () => ({}),
      stop: async () => ({}),
      context: () => ({}),
      subscribe: () => () => {},
    });
    const call = (id: string, requestId: string, extra = {}) =>
      tools.execute({ id, name, args: { requestId, ...extra } });
    await expect(call("sdk-old", "old")).rejects.toMatchObject({ code: "transcript_unavailable" });
    tools.beginUserTurn?.();
    tools.userTranscript("unrelated newer input");
    await expect(call("sdk-new", "old")).rejects.toMatchObject({ code: "request_already_used" });
    await expect(call("invalid", "invalid", { text: "fabricated" })).rejects.toThrow("Unexpected");
    tools.beginUserTurn?.();
    tools.userTranscript("another input");
    await expect(call("invalid-retry", "invalid")).rejects.toMatchObject({ code: "request_already_used" });
    expect(sent).toEqual([]);
    await call("sdk-current", "current");
    expect(sent).toEqual(["another input"]);
    tools.userTranscript("still unused");
    await expect(
      tools.execute({ name: name === "agent_send" ? "agent_steer" : "agent_send", args: { requestId: "current" } }),
    ).rejects.toMatchObject({ code: "request_already_used" });
    await call("sdk-next", "next");
    expect(sent).toEqual(["another input", "still unused"]);
  });
}

test("request tombstones never evict at capacity, including across activity and expiry", async () => {
  let now = 0;
  let sends = 0;
  const tools = createOrchestration(
    {
      send: async () => {
        sends++;
      },
      steer: async () => {
        sends++;
      },
      list: async () => ({}),
      inspect: async () => ({}),
      stop: async () => ({}),
      context: () => ({}),
      subscribe: () => () => {},
    },
    () => now,
  );
  const send = (requestId: string) => tools.execute({ name: "agent_send", args: { requestId } });
  for (let i = 0; i < 256; i++) await expect(send(String(i))).rejects.toMatchObject({ code: "transcript_unavailable" });
  now += 120_000;
  tools.beginUserTurn?.();
  tools.userTranscript("new input");
  await expect(send("0")).rejects.toMatchObject({ code: "request_already_used" });
  await expect(send("overflow")).rejects.toMatchObject({ code: "request_limit" });
  expect(sends).toBe(0);
  await expect(tools.execute({ name: "jobs_list" })).resolves.toEqual({});
});
