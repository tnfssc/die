import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";
import * as z from "zod/mini";
import { JobService } from "../src/tasks/job-service";
import { T3LaunchIdentityLedger } from "../src/tasks/t3-launch-identity";
import { McpAmbiguousResponseError } from "../src/tasks/t3-mcp-client";
import { T3NativeTaskAdapter, T3TaskResultSchema } from "../src/tasks/t3-native-task";
import { TaskManager } from "../src/tasks/task-manager";
import { serveJobBridge, withJobRequestIdentity } from "../src/typescript/job-bridge";

const fixture = JSON.parse(await readFile(new URL("./fixtures/t3-native-task-contract.json", import.meta.url), "utf8"));
const servers: Bun.Server<unknown>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function nativeServer(calls: Array<{ name: string; arguments: Record<string, unknown> }>) {
  let session = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      const rpc = (await request.json()) as any;
      if (rpc.method === "initialize")
        return Response.json(
          {
            jsonrpc: "2.0",
            id: rpc.id,
            result: { protocolVersion: "2025-06-18", capabilities: {} },
          },
          { headers: { "mcp-session-id": "native-" + ++session } },
        );
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      const call = rpc.params as {
        name: string;
        arguments: Record<string, unknown>;
      };
      calls.push(call);
      const entry = Object.values(fixture).find((item: any) => item.tool === call.name) as any;
      if (!entry)
        return Response.json({
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -1 },
        });
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: { structuredContent: entry.result },
      });
    },
  });
  servers.push(server);
  return "http://127.0.0.1:" + server.port + "/mcp";
}

function context(sessionFile: string) {
  return {
    cwd: process.cwd(),
    sessionManager: {
      getSessionFile: () => sessionFile,
      getSessionId: () => "parent-session",
      getLeafId: () => "parent-leaf",
    },
  } as any;
}

test("native contract fixture is exact version 1", () => {
  expect(z.parse(T3TaskResultSchema, fixture.launch.result)).toEqual(fixture.launch.result);
  expect(() =>
    z.parse(T3TaskResultSchema, {
      ...fixture.launch.result,
      legacyStatus: "queued",
    }),
  ).toThrow();
  expect(() => z.parse(T3TaskResultSchema, { ...fixture.launch.result, version: 2 })).toThrow();
  expect(() => z.parse(T3TaskResultSchema, { ...fixture.launch.result, depth: 3 })).toThrow();
});

test("scoped execute routing uses native launch/observe/list/cancel without local child ownership", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const endpoint = nativeServer(calls);
  const dir = await mkdtemp(join(tmpdir(), "die-native-root-"));
  const sessionFile = join(dir, "parent.jsonl");
  await writeFile(sessionFile, "");
  const manager = new TaskManager(() => {});
  const spawn = spyOn(manager, "spawn");
  const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined, {
    T3_MCP_URL: endpoint,
    T3_MCP_BEARER_TOKEN: "server-issued",
  });
  const signal = withJobRequestIdentity(new AbortController().signal, {
    executeInvocationId: "execute-invocation-1",
    callIndex: 1,
  });
  try {
    const launched = (await service.handle(
      "subagent",
      { prompt: fixture.launch.arguments.prompt, type: "fast" },
      context(sessionFile),
      signal,
    )) as any;
    expect(launched).toMatchObject({
      id: fixture.launch.result.taskId,
      taskId: fixture.launch.result.taskId,
      childThreadId: fixture.launch.result.childThreadId,
      status: "running",
      profile: "fast",
      depth: 1,
      background: true,
    });
    expect(launched.output).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    expect(manager.list()).toHaveLength(0);

    const observed = (await service.handle(
      "jobs.inspect",
      { id: fixture.launch.result.taskId },
      context(sessionFile),
      signal,
    )) as any;
    expect(observed).toMatchObject({
      status: "completed",
      output: "done",
      transferId: "transfer-1",
    });

    const listed = (await service.handle("jobs.list", {}, context(sessionFile), signal)) as any;
    expect(listed.jobs).toHaveLength(1);
    expect(listed.jobs[0]).toMatchObject({
      id: "native-task-1",
      background: true,
    });

    const stopped = (await service.handle(
      "jobs.stop",
      { id: fixture.launch.result.taskId },
      context(sessionFile),
      signal,
    )) as any;
    expect(stopped.status).toBe("cancelled");
    expect(stopped.cancellationRequested).toBe(true);
    expect(calls.map((call) => call.name)).toEqual([
      "die_task_launch",
      "die_task_observe",
      "die_task_list",
      "die_task_cancel",
    ]);
    expect(calls[0]!.arguments).toMatchObject({
      prompt: fixture.launch.arguments.prompt,
      profile: "fast",
    });
    expect(typeof calls[0]!.arguments.clientRequestId).toBe("string");
  } finally {
    spawn.mockRestore();
    await manager.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("scoped native affordances reject waiting and stream controls while local shell stays faithful", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const endpoint = nativeServer(calls);
  const dir = await mkdtemp(join(tmpdir(), "die-native-controls-"));
  const sessionFile = join(dir, "parent.jsonl");
  await writeFile(sessionFile, "");
  const manager = new TaskManager(() => {});
  const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined, {
    T3_MCP_URL: endpoint,
    T3_MCP_BEARER_TOKEN: "server-issued",
  });
  const ctx = context(sessionFile);
  const signal = withJobRequestIdentity(new AbortController().signal, {
    executeInvocationId: "execute-invocation-2",
    callIndex: 1,
  });
  try {
    const launched = (await service.handle("subagent", { prompt: "x", waitSeconds: 0 }, ctx, signal)) as any;
    expect(launched).toMatchObject({ background: true, id: "native-task-1" });
    await expect(service.handle("subagent", { prompt: "x", waitSeconds: 1 }, ctx, signal)).rejects.toThrow(
      "Positive waitSeconds is unsupported",
    );
    await expect(service.handle("subagent", { prompt: "x", timeoutSeconds: 1 }, ctx, signal)).rejects.toThrow(
      "timeoutSeconds is unsupported",
    );
    for (const [method, input] of [
      ["jobs.input", { id: "native-task-1", data: "x" }],
      ["jobs.closeInput", { id: "native-task-1" }],
      ["jobs.snooze", { id: "native-task-1", minutes: 1 }],
      ["jobs.setWatch", { id: "native-task-1", enabled: false }],
    ] as const)
      await expect(service.handle(method, input, ctx, signal)).rejects.toThrow("unsupported");

    const shell = (await service.handle("shell", { command: "printf local", waitSeconds: 1 }, ctx, signal)) as any;
    expect(shell.output).toBe("local");
    expect(calls).toHaveLength(1);
  } finally {
    await manager.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("adapter replays an ambiguous launch with exactly the persisted request identity", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let attempt = 0;
  const client = {
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (attempt++ === 0) throw new McpAmbiguousResponseError("response lost");
      return { structuredContent: fixture.launch.result };
    },
    async close() {},
  } as any;
  const adapter = new T3NativeTaskAdapter(client);
  const result = await adapter.launch(fixture.launch.arguments);
  expect(result.taskId).toBe("native-task-1");
  expect(calls).toHaveLength(2);
  expect(calls[0]!.args.clientRequestId).toBe(fixture.launch.arguments.clientRequestId);
  expect(calls[1]!.args.clientRequestId).toBe(fixture.launch.arguments.clientRequestId);
});

test("adapter does not retry permanent protocol or authorization rejection", async () => {
  let calls = 0;
  const client = {
    callTool: async () => {
      calls++;
      throw new Error("permanent rejection");
    },
    close: async () => {},
  } as any;
  await expect(new T3NativeTaskAdapter(client).launch(fixture.launch.arguments)).rejects.toThrow("permanent rejection");
  expect(calls).toBe(1);
});

test("typed backend rejection is not mistaken for a task or reflected into output", async () => {
  const client = {
    callTool: async () => ({
      structuredContent: {
        code: "capability_denied",
        message: "SECRET_FIXTURE_VALUE",
        _tag: "OrchestratorMcpFailure",
      },
    }),
    close: async () => {},
  } as any;
  const adapter = new T3NativeTaskAdapter(client);
  const error = await adapter.launch(fixture.launch.arguments).catch((error: Error) => error);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("capability_denied");
  expect(String(error)).not.toContain("SECRET_FIXTURE_VALUE");
});

test("launch intent survives ACK while durable pending bookkeeping is released", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-native-ledger-"));
  const path = join(dir, "launches.json");
  try {
    const first = new T3LaunchIdentityLedger(path);
    const requestId = await first.reserve("same-logical-call");
    const disk = JSON.parse(await readFile(path, "utf8"));
    expect(disk.pending).toEqual([{ fingerprint: "same-logical-call", clientRequestId: requestId }]);
    const recovered = await new T3LaunchIdentityLedger(path).reserve("same-logical-call");
    expect(recovered).toBe(requestId);
    await first.acknowledge(requestId);
    const next = await new T3LaunchIdentityLedger(path).reserve("same-logical-call");
    expect(next).toBe(requestId);
    expect(await first.reserve("different-logical-call")).not.toBe(requestId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bounded launch bookkeeping eviction preserves replay identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-native-ledger-bound-"));
  const path = join(dir, "launches.json");
  try {
    const ledger = new T3LaunchIdentityLedger(path);
    const oldest = await ledger.reserve("intent-0");
    for (let index = 1; index <= 260; index++) await ledger.reserve("intent-" + index);
    expect(JSON.parse(await readFile(path, "utf8")).pending).toHaveLength(256);
    expect(await new T3LaunchIdentityLedger(path).reserve("intent-0")).toBe(oldest);
    expect(JSON.parse(await readFile(path, "utf8")).pending).toHaveLength(256);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("execute response ACK retires durable pending launch bookkeeping", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-native-ack-"));
  const sessionFile = join(dir, "parent.jsonl");
  await writeFile(sessionFile, "");
  const manager = new TaskManager(() => {});
  const adapter = {
    launch: async () => fixture.launch.result,
    observe: async () => fixture.observe.result,
    cancel: async () => fixture.cancel.result,
    list: async () => fixture.list.result,
    close: async () => {},
  };
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      T3_MCP_URL: "http://backend.invalid/mcp",
      T3_MCP_BEARER_TOKEN: "server-issued",
    },
    () => adapter,
  );
  const writes: string[] = [];
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      writes.push(chunk.toString("utf8"));
      callback();
    },
  });
  const bridge = serveJobBridge(
    stream,
    (method, params, signal) => service.handle(method, params, context(sessionFile), signal),
    new AbortController().signal,
    undefined,
    "execute-ack-invocation",
  );
  try {
    stream.push(
      JSON.stringify({
        id: 1,
        method: "subagent",
        params: { prompt: "Implement the worker", type: "fast" },
      }) + "\n",
    );
    for (let i = 0; !writes.length && i < 100; i++) await Bun.sleep(1);
    expect(JSON.parse(writes.join("")).result).toMatchObject({
      background: true,
      id: "native-task-1",
    });
    const ledgerPath = sessionFile + ".t3-launches-v1.json";
    expect(JSON.parse(await readFile(ledgerPath, "utf8")).pending).toHaveLength(1);
    stream.push(JSON.stringify({ ack: 1 }) + "\n");
    for (let i = 0; i < 100; i++) {
      if (JSON.parse(await readFile(ledgerPath, "utf8")).pending.length === 0) break;
      await Bun.sleep(1);
    }
    expect(JSON.parse(await readFile(ledgerPath, "utf8")).pending).toHaveLength(0);
  } finally {
    bridge.close();
    stream.destroy();
    await manager.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("identical concurrent native calls get distinct durable intents and replay by execute ordinal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-native-concurrent-replay-"));
  const sessionFile = join(dir, "parent.jsonl");
  await writeFile(sessionFile, "");
  const ledgerPath = sessionFile + ".t3-launches-v1.json";
  const environment = {
    T3_MCP_URL: "http://backend.invalid/mcp",
    T3_MCP_BEARER_TOKEN: "server-issued",
  };
  const originalIds: string[] = [];
  const replayedIds: string[] = [];
  const managers: TaskManager[] = [];

  const run = async (replay: boolean) => {
    const manager = new TaskManager(() => {});
    managers.push(manager);
    const adapter = {
      async launch(input: any) {
        const ids = replay ? replayedIds : originalIds;
        ids.push(input.clientRequestId);
        if (!replay) throw new Error("ambiguous launch response");
        const ordinal = originalIds.indexOf(input.clientRequestId);
        if (ordinal < 0) throw new Error("replay did not recover its durable call identity");
        return {
          ...fixture.launch.result,
          taskId: "native-task-" + (ordinal + 1),
          childThreadId: "child-thread-" + (ordinal + 1),
          profile: "normal",
          depth: 2,
        };
      },
      observe: async () => fixture.observe.result,
      cancel: async () => fixture.cancel.result,
      list: async () => fixture.list.result,
      close: async () => {},
    };
    const service = new JobService(
      manager,
      // Scoped routing must not consult this local policy.
      () => ({ depth: 99, type: "fast" }),
      undefined,
      undefined,
      undefined,
      undefined,
      environment,
      () => adapter,
    );
    const writes: string[] = [];
    const stream = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        writes.push(chunk.toString("utf8"));
        callback();
      },
    });
    const bridge = serveJobBridge(
      stream,
      (method, params, signal) => service.handle(method, params, context(sessionFile), signal),
      new AbortController().signal,
      undefined,
      "durable-execute-tool-call",
    );
    stream.push(
      JSON.stringify({
        id: 1,
        method: "subagent",
        params: { prompt: "same", type: "fast" },
      }) +
        "\n" +
        JSON.stringify({
          id: 2,
          method: "subagent",
          params: { prompt: "same", type: "fast" },
        }) +
        "\n",
    );
    for (let i = 0; writes.join("").trim().split("\n").filter(Boolean).length < 2 && i < 500; i++) await Bun.sleep(1);
    const responses = writes
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    bridge.close(false);
    stream.destroy();
    return responses;
  };

  try {
    const failed = await run(false);
    expect(failed).toHaveLength(2);
    expect(failed.every((response) => typeof response.error === "string")).toBe(true);
    expect(originalIds).toHaveLength(2);
    expect(new Set(originalIds).size).toBe(2);
    expect((JSON.parse(await readFile(ledgerPath, "utf8")) as any).pending).toHaveLength(2);

    const recovered = await run(true);
    expect(replayedIds).toEqual(originalIds);
    expect(recovered.map((response) => response.result.id).sort()).toEqual(["native-task-1", "native-task-2"]);
  } finally {
    await Promise.all(managers.map((manager) => manager.shutdown()));
    await rm(dir, { recursive: true, force: true });
  }
});

function localTask(id: string): any {
  return {
    id,
    kind: "command",
    command: id,
    cwd: process.cwd(),
    status: "completed",
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    baseOffset: 0,
    outputEnd: 0,
    timedOut: false,
  };
}

test("mixed pagination keeps the backend cursor stable when local membership changes", async () => {
  for (const mutate of ["add", "remove"] as const) {
    const manager = new TaskManager(() => {});
    let locals = [localTask("local-1")];
    const listSpy = spyOn(manager, "list").mockImplementation(() => locals);
    const native = [
      {
        ...fixture.launch.result,
        taskId: "native-a",
        childThreadId: "thread-a",
      },
      {
        ...fixture.launch.result,
        taskId: "native-b",
        childThreadId: "thread-b",
      },
    ];
    const cursors: string[] = [];
    const adapter = {
      launch: async () => native[0],
      observe: async () => native[0],
      cancel: async () => native[0],
      close: async () => {},
      list: async ({ cursor = "0", count = 20 }: any) => {
        cursors.push(cursor);
        const offset = Number(cursor);
        const tasks = native.slice(offset, offset + count);
        return {
          tasks,
          total: native.length,
          nextCursor: offset + tasks.length < native.length ? String(offset + tasks.length) : undefined,
        };
      },
    };
    const service = new JobService(
      manager,
      () => ({ depth: 0 }),
      undefined,
      undefined,
      undefined,
      undefined,
      {
        T3_MCP_URL: "http://backend.invalid/mcp",
        T3_MCP_BEARER_TOKEN: "token",
      },
      () => adapter,
    );
    const first = (await service.handle(
      "jobs.list",
      { count: 2 },
      { cwd: process.cwd() } as any,
      new AbortController().signal,
    )) as any;
    expect(first.jobs.map((job: any) => job.id)).toEqual(["local-1", "native-a"]);
    locals = mutate === "add" ? [localTask("local-1"), localTask("local-2")] : [];
    const second = (await service.handle(
      "jobs.list",
      { count: 2, cursor: first.nextCursor },
      { cwd: process.cwd() } as any,
      new AbortController().signal,
    )) as any;
    expect(second.jobs.map((job: any) => job.id)).toEqual(["native-b"]);
    expect(cursors).toEqual(["0", "1"]);
    listSpy.mockRestore();
    await manager.shutdown();
  }
});

test("stopping an already completed native task does not claim cancellation", async () => {
  const manager = new TaskManager(() => {});
  const completed = { ...fixture.cancel.result, status: "completed" };
  const adapter = {
    launch: async () => completed,
    observe: async () => completed,
    cancel: async () => completed,
    list: async () => ({ tasks: [], total: 0 }),
    close: async () => {},
  };
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    undefined,
    undefined,
    undefined,
    undefined,
    { T3_MCP_URL: "http://backend.invalid/mcp", T3_MCP_BEARER_TOKEN: "token" },
    () => adapter,
  );
  const stopped = (await service.handle(
    "jobs.stop",
    { id: completed.taskId },
    { cwd: process.cwd() } as any,
    new AbortController().signal,
  )) as any;
  expect(stopped.status).toBe("completed");
  expect(stopped.cancellationRequested).toBeUndefined();
  await manager.shutdown();
});

test("launch ledger path serialization is concurrent-safe and releases churned paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-ledger-churn-"));
  try {
    const samePath = join(dir, "same.json");
    const same = await Promise.all(
      Array.from({ length: 20 }, () => new T3LaunchIdentityLedger(samePath).reserve("same")),
    );
    expect(new Set(same).size).toBe(1);
    await Promise.all(
      Array.from({ length: 300 }, async (_, index) => {
        const ledger = new T3LaunchIdentityLedger(join(dir, index + ".json"));
        const id = await ledger.reserve("fingerprint");
        await ledger.acknowledge(id);
      }),
    );
    expect(T3LaunchIdentityLedger.activePathCountForTesting()).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("model-directed shell environments omit T3 credentials but retain unrelated variables", async () => {
  const oldUrl = process.env.T3_MCP_URL;
  const oldToken = process.env.T3_MCP_BEARER_TOKEN;
  const oldSafe = process.env.DIE_SAFE_SENTINEL;
  process.env.T3_MCP_URL = "http://secret.invalid/mcp";
  process.env.T3_MCP_BEARER_TOKEN = "SECRET_TOKEN";
  process.env.DIE_SAFE_SENTINEL = "safe-value";
  const manager = new TaskManager(() => {});
  const service = new JobService(manager, () => ({ depth: 0 }));
  try {
    const result = (await service.handle(
      "shell",
      {
        command: 'printf "%s|%s|%s" "$T3_MCP_URL" "$T3_MCP_BEARER_TOKEN" "$DIE_SAFE_SENTINEL"',
        waitSeconds: 2,
      },
      { cwd: process.cwd() } as any,
      new AbortController().signal,
    )) as any;
    expect(result.output).toBe("||safe-value");
  } finally {
    if (oldUrl === undefined) delete process.env.T3_MCP_URL;
    else process.env.T3_MCP_URL = oldUrl;
    if (oldToken === undefined) delete process.env.T3_MCP_BEARER_TOKEN;
    else process.env.T3_MCP_BEARER_TOKEN = oldToken;
    if (oldSafe === undefined) delete process.env.DIE_SAFE_SENTINEL;
    else process.env.DIE_SAFE_SENTINEL = oldSafe;
    await manager.shutdown();
  }
});

test("native worktree batches reuse the first resolved immutable base", async () => {
  const root = await mkdtemp(join(tmpdir(), "die-native-pin-"));
  const sessionFile = join(root, "parent.jsonl");
  await writeFile(sessionFile, "");
  const manager = new TaskManager(() => {});
  const seen: any[] = [];
  const oid = "a".repeat(40);
  const adapter = {
    async launch(input: any) {
      seen.push(input.workspace);
      return {
        ...fixture.launch.result,
        taskId: "native-" + seen.length,
        childThreadId: "thread-" + seen.length,
        workspace: {
          kind: "worktree",
          baseRef: oid,
          branch: "die/agent-" + seen.length,
          preparationStatus: "preparing",
        },
      };
    },
    observe: async () => fixture.observe.result,
    cancel: async () => fixture.cancel.result,
    list: async () => fixture.list.result,
    close: async () => {},
  };
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      T3_MCP_URL: "http://127.0.0.1:1/mcp",
      T3_MCP_BEARER_TOKEN: "token",
    },
    () => adapter,
  );
  try {
    const signal = withJobRequestIdentity(new AbortController().signal, {
      executeInvocationId: "pin-batch",
      callIndex: 1,
    });
    const result = (await service.handle(
      "subagent",
      {
        prompts: ["one", "two", "three"],
        workspace: { kind: "worktree", baseRef: "HEAD" },
        waitSeconds: 0,
      },
      context(sessionFile),
      signal,
    )) as any[];
    expect(result).toHaveLength(3);
    expect(seen[0].baseRef).toBe("HEAD");
    expect(seen.slice(1).map((item) => item.baseRef)).toEqual([oid, oid]);
  } finally {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
