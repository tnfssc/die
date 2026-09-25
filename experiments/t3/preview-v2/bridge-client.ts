/** Execute-accessible client for T3's session-scoped orchestration MCP endpoint. */
export const T3_MCP_URL_ENV = "T3_MCP_URL";
export const T3_MCP_BEARER_ENV = "T3_MCP_BEARER_TOKEN";
const PROTOCOL_VERSION = "2025-06-18";

export interface DelegateTaskInput {
  task: string;
  target?: Record<string, unknown>;
  title?: string;
  role?: string;
  mode?: "async" | "wait";
  timeoutMs?: number;
  clientRequestId?: string;
  runtimeMode?: string;
  interactionMode?: string;
}

export interface T3ToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

function parseResponse(body: string, contentType: string, id: number): any {
  if (!contentType.includes("text/event-stream")) {
    const response = JSON.parse(body);
    if (response.id !== id) throw new Error("T3 MCP response ID mismatch");
    return response;
  }
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data && data !== "[DONE]") {
      const response = JSON.parse(data);
      if (response.id === id && ("result" in response || "error" in response)) return response;
    }
  }
  throw new Error("T3 MCP returned an empty SSE response");
}

/** A deliberately small Streamable HTTP client; it never starts a local Die subagent. */
export class T3ExecuteBridgeClient {
  #id = 0;
  #sessionId: string | undefined;
  #initialized = false;

  constructor(readonly endpoint: string, private readonly bearer: string) {}

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env) {
    const endpoint = env[T3_MCP_URL_ENV];
    const bearer = env[T3_MCP_BEARER_ENV];
    if (!endpoint || !bearer) {
      throw new Error(`T3 execute bridge requires inherited ${T3_MCP_URL_ENV} and ${T3_MCP_BEARER_ENV}`);
    }
    return new T3ExecuteBridgeClient(endpoint, bearer);
  }

  async request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    const id = ++this.#id;
    const response = await fetch(this.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.bearer}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(this.#sessionId ? { "mcp-session-id": this.#sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
      signal,
    });
    if (!response.ok) throw new Error(`T3 MCP HTTP ${response.status}`);
    this.#sessionId = response.headers.get("mcp-session-id") ?? this.#sessionId;
    const payload = parseResponse(await response.text(), response.headers.get("content-type") ?? "", id);
    if (payload.error) throw new Error(payload.error.message ?? "T3 MCP request failed");
    return payload.result;
  }

  async close(): Promise<void> {
    const sessionId = this.#sessionId;
    this.#sessionId = undefined;
    this.#initialized = false;
    if (!sessionId) return;
    const response = await fetch(this.endpoint, {
      method: "DELETE", redirect: "error",
      headers: { authorization: `Bearer ${this.bearer}`, "mcp-session-id": sessionId, "mcp-protocol-version": PROTOCOL_VERSION },
      signal: AbortSignal.timeout(3000),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) throw new Error(`T3 MCP close HTTP ${response.status}`);
  }

  async initialize(signal?: AbortSignal) {
    if (this.#initialized) return;
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "die-t3-execute-bridge", version: "1" },
    }, signal);
    this.#initialized = true;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T3ToolResult> {
    await this.initialize(signal);
    return this.request("tools/call", { name, arguments: args }, signal);
  }

  delegateTask(input: DelegateTaskInput, signal?: AbortSignal): Promise<T3ToolResult> {
    return this.callTool("delegate_task", input as unknown as Record<string, unknown>, signal);
  }
  taskStatus(taskId: string, signal?: AbortSignal): Promise<T3ToolResult> {
    return this.callTool("task_status", { taskId }, signal);
  }

  taskCancel(taskId: string, signal?: AbortSignal): Promise<T3ToolResult> {
    return this.callTool("task_cancel", { taskId }, signal);
  }
}

async function withClient<T>(use: (client: T3ExecuteBridgeClient) => Promise<T>): Promise<T> {
  const client = T3ExecuteBridgeClient.fromEnvironment();
  let result: T;
  try { result = await use(client); }
  catch (error) { await client.close().catch(() => undefined); throw error; }
  await client.close();
  return result;
}

/** Delegate through T3 from a Die execute program. No local subagent is created. */
export async function delegateTask(input: DelegateTaskInput, signal?: AbortSignal): Promise<T3ToolResult> {
  return withClient(client => client.delegateTask(input, signal));
}

export async function taskStatus(taskId: string, signal?: AbortSignal): Promise<T3ToolResult> {
  return withClient(client => client.taskStatus(taskId, signal));
}

export async function taskCancel(taskId: string, signal?: AbortSignal): Promise<T3ToolResult> {
  return withClient(client => client.taskCancel(taskId, signal));
}
