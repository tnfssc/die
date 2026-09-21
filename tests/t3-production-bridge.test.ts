import { afterEach, expect, spyOn, test } from "bun:test";
import { JobService } from "../src/tasks/job-service";
import { T3_MCP_PROTOCOL_VERSION, T3McpClient, t3BridgeEnvironment } from "../src/tasks/t3-mcp-client";
import { T3NativeTaskAdapter } from "../src/tasks/t3-native-task";
import { TaskManager } from "../src/tasks/task-manager";

const servers: Bun.Server<unknown>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});
function listen(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch });
  servers.push(server);
  return "http://127.0.0.1:" + server.port + "/mcp";
}
function rpc(request: Request) {
  return request.json() as Promise<any>;
}
function json(id: number, result: unknown, headers: HeadersInit = {}) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers });
}

test("bridge authorization is all-or-nothing and endpoint credentials are rejected", () => {
  expect(t3BridgeEnvironment({})).toEqual({ kind: "local" });
  expect(() => t3BridgeEnvironment({ T3_MCP_URL: "", T3_MCP_BEARER_TOKEN: "" })).toThrow("both");
  expect(() => t3BridgeEnvironment({ T3_MCP_URL: "" })).toThrow("both");
  expect(() => t3BridgeEnvironment({ T3_MCP_URL: "http://127.0.0.1/mcp" })).toThrow("both");
  expect(() => t3BridgeEnvironment({ T3_MCP_BEARER_TOKEN: "secret" })).toThrow("both");
  expect(() =>
    t3BridgeEnvironment({
      T3_MCP_URL: "file:///tmp/mcp",
      T3_MCP_BEARER_TOKEN: "secret",
    }),
  ).toThrow("protocol");
  expect(() =>
    t3BridgeEnvironment({
      T3_MCP_URL: "http://user:pass@localhost/mcp",
      T3_MCP_BEARER_TOKEN: "secret",
    }),
  ).toThrow("credentials");
  for (const suffix of ["?access_token=secret", "#secret"]) {
    expect(() =>
      t3BridgeEnvironment({
        T3_MCP_URL: "http://localhost/mcp" + suffix,
        T3_MCP_BEARER_TOKEN: "secret",
      }),
    ).toThrow("query or fragment");
  }
});

test("partial bridge context fails closed without spawning a local child", async () => {
  const manager = new TaskManager(() => {});
  const spawn = spyOn(manager, "spawn");
  const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined, {
    T3_MCP_URL: "http://127.0.0.1/mcp",
  });
  try {
    const error = await service
      .handle("subagent", { prompt: "work" }, { cwd: process.cwd() } as any, new AbortController().signal)
      .catch((value) => value);
    expect(String(error)).toContain("requires both");
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    spawn.mockRestore();
    await manager.shutdown();
  }
});

test("MCP client sends scoped auth/protocol/session headers, parses bounded SSE, and deletes its session", async () => {
  const calls: Array<{
    method: string;
    auth: string | null;
    protocol: string | null;
    session: string | null;
  }> = [];
  let deleted = 0;
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") {
      deleted++;
      return new Response(null, { status: 204 });
    }
    const body = await rpc(request);
    calls.push({
      method: body.method,
      auth: request.headers.get("authorization"),
      protocol: request.headers.get("mcp-protocol-version"),
      session: request.headers.get("mcp-session-id"),
    });
    if (body.method === "initialize")
      return json(
        body.id,
        {
          protocolVersion: T3_MCP_PROTOCOL_VERSION,
          capabilities: {},
          serverInfo: { name: "fixture", version: "1" },
        },
        { "mcp-session-id": "owned-session" },
      );
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    const data =
      'data: {"jsonrpc":"2.0","id":999,"result":{}}\n\n' +
      "data: " +
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          structuredContent: { taskId: "remote-1", status: "running" },
        },
      }) +
      "\n\n";
    return new Response(data, {
      headers: { "content-type": "text/event-stream" },
    });
  });
  const client = new T3McpClient(endpoint, "scoped-token");
  expect((await client.callTool("die_task_observe", { taskId: "remote-1" })).structuredContent).toEqual({
    taskId: "remote-1",
    status: "running",
  });
  await client.close();
  expect(calls.map((call) => call.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
  expect(calls.every((call) => call.auth === "Bearer scoped-token" && call.protocol === T3_MCP_PROTOCOL_VERSION)).toBe(
    true,
  );
  expect(calls[0]!.session).toBeNull();
  expect(calls[2]!.session).toBe("owned-session");
  expect(deleted).toBe(1);
});

test("MCP client rejects oversized finite responses", async () => {
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    const body = await rpc(request);
    return new Response("x".repeat(1_000_001), {
      headers: {
        "content-type": "text/event-stream",
        "mcp-session-id": "oversized",
      },
      status: body.method === "initialize" ? 200 : 500,
    });
  });
  const client = new T3McpClient(endpoint, "token");
  await expect(client.callTool("die_task_observe", { taskId: "x" })).rejects.toThrow("exceeds 1 MB");
  await client.close().catch(() => undefined);
});

test("MCP client reconnects one expired session and preserves the tool request", async () => {
  let initialize = 0,
    tools = 0,
    session = "";
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    const body = await rpc(request);
    if (body.method === "initialize") {
      session = "session-" + ++initialize;
      return json(body.id, {}, { "mcp-session-id": session });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    tools++;
    if (tools === 1) return new Response("expired", { status: 404 });
    expect(request.headers.get("mcp-session-id")).toBe("session-2");
    return json(body.id, {
      structuredContent: {
        taskId: body.params.arguments.taskId,
        status: "completed",
        output: "done",
      },
    });
  });
  const client = new T3McpClient(endpoint, "token");
  const result = await client.callTool("die_task_observe", {
    taskId: "remote-retry",
  });
  expect(result.structuredContent).toMatchObject({
    taskId: "remote-retry",
    status: "completed",
  });
  expect({ initialize, tools }).toEqual({ initialize: 2, tools: 2 });
  await client.close();
});

test("aborted MCP requests stop promptly and close remains bounded", async () => {
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    await Bun.sleep(5_000);
    return json(1, {});
  });
  const client = new T3McpClient(endpoint, "token");
  const controller = new AbortController();
  const pending = client.callTool("die_task_observe", { taskId: "x" }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await expect(pending).rejects.toThrow();
  await client.close();
});

test("repeated client sessions release every server session", async () => {
  let initialized = 0,
    deleted = 0;
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") {
      deleted++;
      return new Response(null, { status: 204 });
    }
    const body = await rpc(request);
    if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": "cycle-" + ++initialized });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return json(body.id, {
      structuredContent: { taskId: "x", status: "completed" },
    });
  });
  for (let index = 0; index < 20; index++) {
    const client = new T3McpClient(endpoint, "token");
    await client.callTool("die_task_observe", { taskId: "x" });
    await client.close();
  }
  expect({ initialized, deleted }).toEqual({ initialized: 20, deleted: 20 });
});

test("MCP client enforces the delegation allowlist and request key before transport", async () => {
  const client = new T3McpClient("http://127.0.0.1:1/mcp", "token");
  await expect(client.callTool("create_threads", {})).rejects.toThrow("not allowed");
  for (const clientRequestId of [undefined, "", "   ", "x".repeat(129)]) {
    await expect(client.callTool("die_task_launch", { clientRequestId })).rejects.toThrow("clientRequestId");
  }
  await client.close();
});

test("MCP client does not retry a 400 mutation and redacts reflected server errors", async () => {
  let calls = 0;
  const secret = "server-reflected-bearer-secret";
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    const body = await rpc(request);
    if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": "redaction-session" });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    calls++;
    if (body.params.arguments.clientRequestId === "no-400-retry") return new Response(secret, { status: 400 });
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32000, message: secret, data: secret },
    });
  });
  const client = new T3McpClient(endpoint, secret);
  const first = await client
    .callTool("die_task_launch", { task: "x", clientRequestId: "no-400-retry" })
    .catch((error) => error);
  expect(String(first)).toContain("HTTP 400");
  expect(String(first)).not.toContain(secret);
  expect(calls).toBe(1);
  const reflected = await client.callTool("die_task_observe", { taskId: "x" }).catch((error) => error);
  expect(String(reflected)).toContain("request failed");
  expect(String(reflected)).not.toContain(secret);
  await client.close();
});

test("MCP client rejects malformed and mismatched RPC responses", async () => {
  let mode: "schema" | "id" = "schema";
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    const body = await rpc(request);
    if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": "invalid-session" });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return mode === "schema"
      ? Response.json({ jsonrpc: "1.0", id: body.id, result: {} })
      : Response.json({ jsonrpc: "2.0", id: body.id + 1, result: {} });
  });
  const client = new T3McpClient(endpoint, "token");
  await expect(client.callTool("die_task_observe", { taskId: "x" })).rejects.toThrow("invalid response");
  mode = "id";
  await expect(client.callTool("die_task_observe", { taskId: "x" })).rejects.toThrow("ID mismatch");
  await client.close();
});

test("matching chunked SSE returns and cancels without remote EOF", async () => {
  let cancelled = 0;
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    const body = await rpc(request);
    if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": "endless-session" });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: { structuredContent: { taskId: "x", status: "completed" } },
    });
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: message\r\ndata: " + payload.slice(0, 17)));
          controller.enqueue(new TextEncoder().encode(payload.slice(17) + "\r\n\r\n"));
        },
        cancel() {
          cancelled++;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const client = new T3McpClient(endpoint, "token");
  const result = await Promise.race([
    client.callTool("die_task_observe", { taskId: "x" }),
    Bun.sleep(500).then(() => {
      throw new Error("SSE waited for EOF");
    }),
  ]);
  expect(result.structuredContent).toMatchObject({ status: "completed" });
  for (let index = 0; index < 50 && cancelled === 0; index++) await Bun.sleep(1);
  expect(cancelled).toBe(1);
  await client.close();
});

test("close aborts initialize, waits for settlement, then deletes an acquired session", async () => {
  let initializeStarted = false;
  const order: string[] = [];
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") {
      order.push("delete");
      expect(request.headers.get("mcp-session-id")).toBe("close-init-session");
      return new Response(null, { status: 204 });
    }
    const body = await rpc(request);
    if (body.method !== "initialize") return new Response(null, { status: 202 });
    return new Response(
      new ReadableStream({
        start(controller) {
          initializeStarted = true;
          order.push("initialize-body");
          controller.enqueue(new TextEncoder().encode(" "));
        },
        cancel() {
          order.push("settled");
        },
      }),
      {
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "close-init-session",
        },
      },
    );
  });
  const client = new T3McpClient(endpoint, "token");
  const pending = client.initialize().catch((error) => error);
  while (!initializeStarted) await Bun.sleep(1);
  await client.close();
  expect(await pending).toBeInstanceOf(Error);
  expect(order.indexOf("delete")).toBeGreaterThan(order.indexOf("settled"));
});

test("close during a tool body prevents success and releases the session", async () => {
  let toolStarted = false;
  let deleted = 0;
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") {
      deleted++;
      return new Response(null, { status: 204 });
    }
    const body = await rpc(request);
    if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": "close-tool-session" });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return new Response(
      new ReadableStream({
        start(controller) {
          toolStarted = true;
          controller.enqueue(new TextEncoder().encode("{"));
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const client = new T3McpClient(endpoint, "token");
  const pending = client.callTool("die_task_observe", { taskId: "x" }).catch((error) => error);
  while (!toolStarted) await Bun.sleep(1);
  await client.close();
  expect(await pending).toBeInstanceOf(Error);
  await expect(client.callTool("die_task_observe", { taskId: "x" })).rejects.toThrow("closed");
  expect(deleted).toBe(1);
});

test("concurrent expired requests share one reconnect and preserve each request", async () => {
  let initializes = 0;
  let oldCalls = 0;
  let allOldArrived!: () => void;
  const oldArrived = new Promise<void>((resolve) => (allOldArrived = resolve));
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    const body = await rpc(request);
    if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": "concurrent-" + ++initializes });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.headers.get("mcp-session-id") === "concurrent-1") {
      if (++oldCalls === 2) allOldArrived();
      await oldArrived;
      return new Response(null, { status: 404 });
    }
    return json(body.id, {
      structuredContent: {
        taskId: body.params.arguments.taskId,
        status: "completed",
      },
    });
  });
  const client = new T3McpClient(endpoint, "token");
  await client.initialize();
  const results = await Promise.all([
    client.callTool("die_task_observe", { taskId: "a" }),
    client.callTool("die_task_observe", { taskId: "b" }),
  ]);
  expect(results.map((result: any) => result.structuredContent.taskId).sort()).toEqual(["a", "b"]);
  expect(initializes).toBe(2);
  await client.close();
});

test("SSE multiline JSON survives CRLF split across chunks without waiting for EOF", async () => {
  let cancelled = 0;
  const mockFetch = Object.assign(
    async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      const body = JSON.parse(String(init?.body));
      if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": "split-session" });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      const chunks = [
        'data: {"jsonrpc":"2.0",\r',
        '\ndata: "id":' + body.id + ',"result":\r',
        '\ndata: {"structuredContent":{"taskId":"split"}}}\r',
        "\n\r",
        "\n",
      ];
      return new Response(
        new ReadableStream({
          pull(controller) {
            const chunk = chunks.shift();
            if (chunk !== undefined) controller.enqueue(new TextEncoder().encode(chunk));
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
    { preconnect: fetch.preconnect },
  );
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(mockFetch);
  const client = new T3McpClient("http://127.0.0.1/mcp", "token");
  try {
    const result = await client.callTool("die_task_observe", {
      taskId: "split",
    });
    expect(result.structuredContent).toEqual({ taskId: "split" });
    expect(cancelled).toBe(1);
  } finally {
    await client.close();
    fetchSpy.mockRestore();
  }
});

test("cancelling one shared initialize waiter leaves the other caller and cleanup owned", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let initializes = 0;
  let deletes = 0;
  const endpoint = listen(async (request) => {
    if (request.method === "DELETE") {
      deletes++;
      return new Response(null, { status: 204 });
    }
    const body = await rpc(request);
    if (body.method === "initialize") {
      initializes++;
      started();
      await barrier;
      return json(body.id, {}, { "mcp-session-id": "shared-init" });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return json(body.id, {
      structuredContent: { taskId: body.params.arguments.taskId },
    });
  });
  const client = new T3McpClient(endpoint, "token");
  const cancelled = new AbortController();
  try {
    const first = client
      .callTool("die_task_observe", { taskId: "cancelled" }, cancelled.signal)
      .catch((error) => error);
    await ready;
    const second = client.callTool("die_task_observe", { taskId: "survives" });
    cancelled.abort();
    expect(String(await first)).toContain("aborted");
    release();
    expect((await second).structuredContent).toEqual({ taskId: "survives" });
    expect(initializes).toBe(1);
  } finally {
    release();
    await client.close();
  }
  expect(deletes).toBe(1);
});

const launchInput = {
  clientRequestId: "stable-request",
  prompt: "work",
  profile: "fast" as const,
};
const launchResult = {
  version: 1 as const,
  taskId: "task-1",
  childThreadId: "thread-1",
  status: "running" as const,
  profile: "fast" as const,
  depth: 1,
  workspace: { kind: "inherit" as const, preparationStatus: "ready" as const },
};

test("native launch replays empty JSON and truncated SSE success with the same key", async () => {
  for (const kind of ["empty-json", "truncated-sse"] as const) {
    const keys: string[] = [];
    const endpoint = listen(async (request) => {
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      const body = await rpc(request);
      if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": kind });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      keys.push(body.params.arguments.clientRequestId);
      if (keys.length === 1)
        return kind === "empty-json"
          ? new Response("", {
              headers: { "content-type": "application/json" },
            })
          : new Response('data: {"jsonrpc":"2.0","id":' + body.id, {
              headers: { "content-type": "text/event-stream" },
            });
      return json(body.id, { structuredContent: launchResult });
    });
    const client = new T3McpClient(endpoint, "token");
    try {
      expect((await new T3NativeTaskAdapter(client).launch(launchInput)).taskId).toBe("task-1");
      expect(keys).toEqual(["stable-request", "stable-request"]);
    } finally {
      await client.close();
    }
  }
});

test("native launch replays an internal timeout but not caller abort or HTTP auth rejection", async () => {
  let calls = 0;
  const timeoutEndpoint = listen(async (request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    const body = await rpc(request);
    if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": "timeout" });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    calls++;
    if (calls === 1) await Bun.sleep(100);
    return json(body.id, { structuredContent: launchResult });
  });
  const timeoutClient = new T3McpClient(timeoutEndpoint, "token", 50);
  try {
    expect((await new T3NativeTaskAdapter(timeoutClient).launch(launchInput)).taskId).toBe("task-1");
    expect(calls).toBe(2);
  } finally {
    await timeoutClient.close();
  }

  for (const mode of ["abort", "auth"] as const) {
    let attempts = 0;
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const endpoint = listen(async (request) => {
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      const body = await rpc(request);
      if (body.method === "initialize") return json(body.id, {}, { "mcp-session-id": mode });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      attempts++;
      started();
      if (mode === "auth") return new Response(null, { status: 401 });
      await Bun.sleep(500);
      return json(body.id, { structuredContent: launchResult });
    });
    const client = new T3McpClient(endpoint, "token");
    const controller = new AbortController();
    try {
      const pending = new T3NativeTaskAdapter(client).launch(launchInput, controller.signal);
      if (mode === "abort") {
        await dispatched;
        controller.abort();
      }
      await expect(pending).rejects.toThrow(mode === "auth" ? "HTTP 401" : "aborted");
      expect(attempts).toBe(1);
    } finally {
      await client.close();
    }
  }
});
