import { T3_MCP_BEARER_ENV, T3_MCP_URL_ENV } from "../../delegation-environment";
import { randomUUID } from "node:crypto";

export const T3_MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_CLIENT_REQUEST_ID_LENGTH = 128;
const REQUEST_TIMEOUT_MS = 30_000;

const CLOSE_TIMEOUT_MS = 3_000;
const ALLOWED_TOOLS = new Set([
  "die_task_launch",
  "die_task_observe",
  "die_task_cancel",
  "die_task_list",
  "die_local_job_notify",
]);
const RETRYABLE_TOOLS = ALLOWED_TOOLS;

/** A request may have committed but its response was lost. Safe only for stable-key replay. */
export class McpAmbiguousResponseError extends Error {}

class McpHttpError extends Error {
  constructor(
    readonly status: number,
    readonly sessionId: string | undefined,
  ) {
    super("T3 MCP HTTP " + status);
  }
}

type RpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: unknown;
};
export interface T3ToolResult {
  content?: Array<{ type?: unknown; text?: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}
export type T3BridgeEnvironment = { kind: "local" } | { kind: "remote"; url: string; token: string };

export function t3BridgeEnvironment(env: NodeJS.ProcessEnv = process.env): T3BridgeEnvironment {
  const url = env[T3_MCP_URL_ENV];
  const token = env[T3_MCP_BEARER_ENV];
  if (url === undefined && token === undefined) return { kind: "local" };
  if (!url || !token) throw new Error("T3 delegation requires both " + T3_MCP_URL_ENV + " and " + T3_MCP_BEARER_ENV);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid " + T3_MCP_URL_ENV);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("Invalid " + T3_MCP_URL_ENV + " protocol");
  if (parsed.username || parsed.password) throw new Error(T3_MCP_URL_ENV + " must not contain credentials");
  // The endpoint is configuration, not a credential transport. Reject rather than
  // log, redirect, or accidentally forward secrets embedded in a query/fragment.
  if (parsed.search || parsed.hash) throw new Error(T3_MCP_URL_ENV + " must not contain a query or fragment");
  return { kind: "remote", url: parsed.href, token };
}

async function withSignal<T>(
  owner: AbortSignal | undefined,
  caller: AbortSignal | undefined,
  milliseconds: number,
  work: (signal: AbortSignal, timedOut: () => boolean) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutFired = false;
  const abort = () => controller.abort();
  if (owner?.aborted || caller?.aborted) controller.abort();
  else {
    owner?.addEventListener("abort", abort, { once: true });
    caller?.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(() => {
    timeoutFired = true;
    controller.abort();
  }, milliseconds);
  try {
    return await work(controller.signal, () => timeoutFired);
  } finally {
    clearTimeout(timer);
    owner?.removeEventListener("abort", abort);
    caller?.removeEventListener("abort", abort);
  }
}

/** Each caller may leave a shared handshake without cancelling other callers. */
async function awaitCaller<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) throw new Error("T3 MCP request aborted");
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error("T3 MCP request aborted"));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

function validateRpc(value: unknown, requestId: number): RpcResponse {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new McpAmbiguousResponseError("T3 MCP returned an invalid response");
  const response = value as Record<string, unknown>;
  if (response.jsonrpc !== "2.0" || response.id !== requestId || "result" in response === "error" in response)
    throw new McpAmbiguousResponseError(
      response.id !== requestId ? "T3 MCP response ID mismatch" : "T3 MCP returned an invalid response",
    );
  return response as RpcResponse;
}

async function readRpc(response: Response, contentType: string, requestId: number): Promise<RpcResponse> {
  if (!response.body) throw new McpAmbiguousResponseError("T3 MCP returned an empty response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  const read = async () => {
    try {
      const chunk = await reader.read();
      if (!chunk.done) {
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw new Error("T3 MCP response exceeds 1 MB");
      }
      return chunk;
    } catch (error) {
      if (error instanceof Error && error.message === "T3 MCP response exceeds 1 MB") throw error;
      throw new McpAmbiguousResponseError("T3 MCP response stream failed");
    }
  };
  try {
    if (!contentType.toLowerCase().includes("text/event-stream")) {
      let body = "";
      for (;;) {
        const chunk = await read();
        if (chunk.done) break;
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        throw new McpAmbiguousResponseError("T3 MCP returned invalid JSON");
      }
      return validateRpc(value, requestId);
    }

    let buffer = "";
    let suppressLeadingLF = false;
    for (;;) {
      const chunk = await read();
      let text = chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      // Treat CRLF as one newline even when the pair straddles reads. Otherwise
      // a split CRLF falsely ends a multiline SSE event before its JSON is whole.
      if (suppressLeadingLF && text.length) {
        if (text.startsWith("\n")) text = text.slice(1);
        suppressLeadingLF = false;
      }
      if (text.length) {
        suppressLeadingLF = text.endsWith("\r");
        buffer += text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      }
      const frames = (buffer + (chunk.done ? "\n\n" : "")).split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data || data === "[DONE]") continue;
        let value: unknown;
        try {
          value = JSON.parse(data);
        } catch {
          continue;
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        if ((value as { id?: unknown }).id !== requestId) continue;
        return validateRpc(value, requestId);
      }
      if (chunk.done) break;
    }
    throw new McpAmbiguousResponseError("T3 MCP returned no matching SSE response");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Session-owning, bounded Streamable HTTP MCP client. */
export class T3McpClient {
  #nextId = 0;
  #sessionId?: string;
  #initialized = false;
  #closed = false;
  #owner = new AbortController();
  #initializing?: Promise<void>;
  #reconnecting?: Promise<void>;
  #inFlight = new Set<Promise<unknown>>();
  #closePromise?: Promise<void>;

  readonly endpoint: string;

  constructor(
    endpoint: string,
    private readonly token: string,
    private readonly requestTimeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new Error("Invalid T3 MCP endpoint");
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("Unsafe T3 MCP endpoint");
    if (!token) throw new Error("T3 MCP bearer token is required");
    this.endpoint = parsed.href;
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): T3McpClient | undefined {
    const config = t3BridgeEnvironment(env);
    return config.kind === "remote" ? new T3McpClient(config.url, config.token) : undefined;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("T3 MCP client is closed");
  }

  #track<T>(work: () => Promise<T>): Promise<T> {
    this.#assertOpen();
    const pending = work();
    this.#inFlight.add(pending);
    void pending.then(
      () => this.#inFlight.delete(pending),
      () => this.#inFlight.delete(pending),
    );
    return pending;
  }

  async #request<T>(
    init: RequestInit,
    caller: AbortSignal | undefined,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    return withSignal(this.#owner.signal, caller, this.requestTimeoutMs, async (signal, timedOut) => {
      let response: Response;
      try {
        response = await fetch(this.endpoint, {
          ...init,
          redirect: "error",
          signal,
        });
      } catch {
        if (caller?.aborted || this.#owner.signal.aborted) throw new Error("T3 MCP request aborted");
        if (timedOut()) throw new McpAmbiguousResponseError("T3 MCP request timed out");
        throw new McpAmbiguousResponseError("T3 MCP transport failed");
      }
      try {
        return await consume(response);
      } catch (error) {
        if (caller?.aborted || this.#owner.signal.aborted) throw new Error("T3 MCP request aborted");
        if (timedOut()) throw new McpAmbiguousResponseError("T3 MCP request timed out");
        throw error;
      }
    });
  }

  async #post(method: string, params: Record<string, unknown> | undefined, caller?: AbortSignal): Promise<unknown> {
    this.#assertOpen();
    const id = ++this.#nextId;
    const requestSession = this.#sessionId;
    return this.#request(
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + this.token,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": T3_MCP_PROTOCOL_VERSION,
          ...(requestSession ? { "mcp-session-id": requestSession } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          ...(params ? { params } : {}),
        }),
      },
      caller,
      async (response) => {
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new McpHttpError(response.status, requestSession);
        }
        const receivedSession = response.headers.get("mcp-session-id");
        if (receivedSession) {
          if (receivedSession.length > 1024 || /[\u0000-\u001f\u007f]/.test(receivedSession)) {
            await response.body?.cancel().catch(() => undefined);
            throw new Error("T3 MCP returned an invalid session ID");
          }
          this.#sessionId = receivedSession;
        }
        const rpc = await readRpc(response, response.headers.get("content-type") ?? "", id);
        this.#assertOpen();
        if ("error" in rpc) throw new Error("T3 MCP request failed");
        return rpc.result;
      },
    );
  }

  async #notify(method: string, caller?: AbortSignal): Promise<void> {
    this.#assertOpen();
    await this.#request(
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + this.token,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": T3_MCP_PROTOCOL_VERSION,
          ...(this.#sessionId ? { "mcp-session-id": this.#sessionId } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", method }),
      },
      caller,
      async (response) => {
        await response.body?.cancel().catch(() => undefined);
        this.#assertOpen();
        if (!response.ok) throw new McpHttpError(response.status, this.#sessionId);
      },
    );
  }

  async #ensureInitialized(caller?: AbortSignal): Promise<void> {
    this.#assertOpen();
    if (caller?.aborted) throw new Error("T3 MCP request aborted");
    if (this.#initialized) return;
    if (!this.#initializing) {
      const pending = this.#track(async () => {
        await this.#post(
          "initialize",
          {
            protocolVersion: T3_MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "die", version: "1" },
          },
          undefined,
        );
        await this.#notify("notifications/initialized");
        this.#assertOpen();
        this.#initialized = true;
      });
      this.#initializing = pending;
      void pending
        .finally(() => {
          if (this.#initializing === pending) this.#initializing = undefined;
        })
        .catch(() => undefined);
    }
    await awaitCaller(this.#initializing, caller);
    this.#assertOpen();
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    return this.#track(() => this.#ensureInitialized(signal));
  }

  async #reconnect(expiredSession: string | undefined, caller?: AbortSignal): Promise<void> {
    this.#assertOpen();
    if (this.#initialized && this.#sessionId !== expiredSession) return;
    if (!this.#reconnecting) {
      const pending = this.#track(async () => {
        if (this.#initialized && this.#sessionId !== expiredSession) return;
        this.#initialized = false;
        if (this.#sessionId === expiredSession) this.#sessionId = undefined;
        await this.#ensureInitialized();
      });
      this.#reconnecting = pending;
      void pending
        .finally(() => {
          if (this.#reconnecting === pending) this.#reconnecting = undefined;
        })
        .catch(() => undefined);
    }
    await awaitCaller(this.#reconnecting, caller);
    this.#assertOpen();
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T3ToolResult> {
    if (!ALLOWED_TOOLS.has(name)) return Promise.reject(new Error("T3 MCP tool is not allowed"));
    if (!args || typeof args !== "object" || Array.isArray(args))
      return Promise.reject(new Error("T3 MCP tool arguments are invalid"));
    if (name === "die_task_launch" || name === "die_local_job_notify") {
      const key = name === "die_task_launch" ? args.clientRequestId : args.notificationId;
      if (typeof key !== "string" || key.trim().length === 0 || key.length > MAX_CLIENT_REQUEST_ID_LENGTH)
        return Promise.reject(
          new Error(
            name +
              " requires a nonempty bounded " +
              (name === "die_task_launch" ? "clientRequestId" : "notificationId"),
          ),
        );
    }
    return this.#track(async () => {
      await this.#ensureInitialized(signal);
      let result: unknown;
      try {
        result = await this.#post("tools/call", { name, arguments: args }, signal);
      } catch (error) {
        if (!(error instanceof McpHttpError) || error.status !== 404 || !RETRYABLE_TOOLS.has(name)) throw error;
        await this.#reconnect(error.sessionId, signal);
        result = await this.#post("tools/call", { name, arguments: args }, signal);
      }
      this.#assertOpen();
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw new Error("T3 MCP tool returned an invalid result");
      const toolResult = result as T3ToolResult;
      if (toolResult.isError !== undefined && typeof toolResult.isError !== "boolean")
        throw new Error("T3 MCP tool returned an invalid result");
      if (toolResult.content !== undefined && !Array.isArray(toolResult.content))
        throw new Error("T3 MCP tool returned an invalid result");
      if (toolResult.isError) throw new Error("T3 " + name + " failed");
      this.#assertOpen();
      return toolResult;
    });
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true; // Stop admission before interrupting owners.
    this.#owner.abort();
    this.#closePromise = (async () => {
      const pending = [...this.#inFlight];
      if (pending.length) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.allSettled(pending),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
          }),
        ]).finally(() => timer && clearTimeout(timer));
      }
      // In-flight initialize is settled (or bounded out) before its acquired
      // session is captured, so a concurrently acquired session is deleted.
      const sessionId = this.#sessionId;
      this.#sessionId = undefined;
      this.#initialized = false;
      if (!sessionId) return;
      await withSignal(undefined, undefined, CLOSE_TIMEOUT_MS, async (signal) => {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 2 && !response; attempt++) {
          try {
            response = await fetch(this.endpoint, {
              method: "DELETE",
              redirect: "error",
              signal,
              headers: {
                authorization: "Bearer " + this.token,
                "mcp-session-id": sessionId,
                "mcp-protocol-version": T3_MCP_PROTOCOL_VERSION,
              },
            });
          } catch {
            if (signal.aborted) throw new Error("T3 MCP close timed out");
            if (attempt === 1) throw new Error("T3 MCP close failed");
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        }
        if (!response) throw new Error("T3 MCP close failed");
        await response.body?.cancel().catch(() => undefined);
        if (!response.ok && response.status !== 404) throw new Error("T3 MCP close HTTP " + response.status);
      });
    })();
    return this.#closePromise;
  }
}

export function newT3RequestId(): string {
  return randomUUID();
}
