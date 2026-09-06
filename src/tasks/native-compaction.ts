import { isDeepStrictEqual } from "node:util";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { calculateCost, type Model, type Usage } from "@earendil-works/pi-ai";
import { getPiUserAgent } from "@earendil-works/pi-ai/utils/pi-user-agent";
import type {
  CompactionEntry,
  CompactionResult,
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { recordDiagnostic } from "../diagnostics.js";
import jobsTemplate from "../prompts/compaction-jobs.md" with { type: "text" };
import noticeTemplate from "../prompts/native-compaction.md" with { type: "text" };
import { reportProviderAttempt } from "./provider-attempts";

export const NATIVE_CODEX_COMPACTION_VERSION = 1;
export const NATIVE_CODEX_SUMMARY = noticeTemplate.trimEnd();
export const NATIVE_CODEX_USAGE_ENTRY = "die-compaction-attempt";
export type CodexCompactionItem = { type: "compaction"; id: string; encrypted_content: string };
export type NativeCodexCompactionDetails = {
  strategy: "codex-native";
  version: 1;
  api: "openai-codex-responses";
  provider: string;
  model: string;
  thinkingLevel?: string | null;
  runtimeState?: string;
  readFiles?: string[];
  modifiedFiles?: string[];
  item: CodexCompactionItem;
};
type CapturedRequest = {
  sessionId: string;
  leafId: string | null;
  model: Model<any>;
  thinkingLevel: string | null;
  messages: AgentMessage[];
  payload?: unknown;
  headers?: Record<string, string | null>;
};
type NativeResponse = { item: CodexCompactionItem; usage: Usage };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function isCodexCompactionItem(value: unknown): value is CodexCompactionItem {
  if (!isRecord(value) || Object.keys(value).length !== 3) return false;
  return (
    value.type === "compaction" &&
    typeof value.id === "string" &&
    value.id.startsWith("cmp_") &&
    typeof value.encrypted_content === "string" &&
    value.encrypted_content.trim().length > 0 &&
    Object.hasOwn(value, "type") &&
    Object.hasOwn(value, "id") &&
    Object.hasOwn(value, "encrypted_content")
  );
}
export function isNativeCodexCompactionDetails(value: unknown): value is NativeCodexCompactionDetails {
  return (
    isRecord(value) &&
    value.strategy === "codex-native" &&
    value.version === 1 &&
    value.api === "openai-codex-responses" &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    (value.thinkingLevel === undefined || typeof value.thinkingLevel === "string" || value.thinkingLevel === null) &&
    (value.runtimeState === undefined || typeof value.runtimeState === "string") &&
    isCodexCompactionItem(value.item)
  );
}

/** Keep every normal provider/cache field byte-for-byte equivalent and append the
 * documented remote-v2 trigger as the final input item. */
export function buildNativeCodexRequest(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.input) || typeof payload.model !== "string") return;
  if (payload.input.some((item) => isRecord(item) && item.type === "compaction_trigger")) return;
  if (payload.stream !== true || payload.store !== false) return;
  // Compaction is deliberately standard-priced even when the captured ordinary
  // request was authorized for fast mode. Avoid hidden premium inference.
  return structuredClone({
    ...payload,
    service_tier: "default",
    input: [...payload.input, { type: "compaction_trigger" }],
  });
}
export function resolveCodexResponsesUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl?.trim() || "https://chatgpt.com/backend-api").replace(/\/+$/, "");
  if (normalized.endsWith("/codex/responses")) return normalized;
  if (normalized.endsWith("/codex")) return normalized + "/responses";
  return normalized + "/codex/responses";
}
function wireCounter(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Codex native compaction returned invalid accounting");
  return value;
}
function usageFromWire(raw: unknown, model: Model<any>): Usage {
  if (!isRecord(raw)) throw new Error("Codex native compaction returned no usable accounting");
  const details = isRecord(raw.input_tokens_details) ? raw.input_tokens_details : {};
  const outputDetails = isRecord(raw.output_tokens_details) ? raw.output_tokens_details : {};
  const totalInput = wireCounter(raw, "input_tokens"),
    output = wireCounter(raw, "output_tokens");
  const cacheRead = details.cached_tokens === undefined ? 0 : wireCounter(details, "cached_tokens");
  const cacheWrite = details.cache_write_tokens === undefined ? 0 : wireCounter(details, "cache_write_tokens");
  const reasoning = outputDetails.reasoning_tokens === undefined ? 0 : wireCounter(outputDetails, "reasoning_tokens");
  if (cacheRead + cacheWrite > totalInput || reasoning > output)
    throw new Error("Codex native compaction returned inconsistent accounting");
  const totalTokens = raw.total_tokens === undefined ? totalInput + output : wireCounter(raw, "total_tokens");
  if (totalTokens < totalInput + output) throw new Error("Codex native compaction returned inconsistent accounting");
  const usage: Usage = {
    input: totalInput - cacheRead - cacheWrite,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
}
export class NativeCodexResponseError extends Error {
  constructor(
    message: string,
    readonly usage?: Usage,
  ) {
    super(message);
    this.name = "NativeCodexResponseError";
  }
}
class NativeCodexHttpError extends Error {
  constructor(readonly status: number) {
    super("Codex native compaction HTTP request was rejected");
    this.name = "NativeCodexHttpError";
  }
}

/** Parse protocol shape only; provider payloads and hidden reasoning never enter errors. */
export function parseNativeCodexEvents(events: readonly unknown[], model: Model<any>): NativeResponse {
  const doneItems: CodexCompactionItem[] = [];
  let terminal: Record<string, unknown> | undefined;
  let terminalType: string | undefined;
  let failure = false;
  let mixed = false;
  for (const event of events) {
    if (!isRecord(event)) continue;
    if (
      event.type === "error" ||
      event.type === "response.failed" ||
      event.type === "response.cancelled" ||
      event.type === "response.incomplete"
    )
      failure = true;
    if (event.type === "response.output_item.done") {
      if (isCodexCompactionItem(event.item)) doneItems.push(structuredClone(event.item));
      else mixed = true;
    }
    if (
      (event.type === "response.completed" ||
        event.type === "response.done" ||
        event.type === "response.failed" ||
        event.type === "response.cancelled" ||
        event.type === "response.incomplete") &&
      isRecord(event.response)
    ) {
      terminal = event.response;
      terminalType = event.type;
    }
  }
  let usage: Usage | undefined;
  let accountingError: unknown;
  try {
    if (terminal?.usage !== undefined) {
      usage = usageFromWire(terminal.usage, model);
      const tier = terminal.service_tier,
        multiplier = tier === "flex" ? 0.5 : tier === "priority" ? (model.id === "gpt-5.5" ? 2.5 : 2) : 1;
      if (multiplier !== 1) {
        usage.cost.input *= multiplier;
        usage.cost.output *= multiplier;
        usage.cost.cacheRead *= multiplier;
        usage.cost.cacheWrite *= multiplier;
        usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
      }
    }
  } catch (error) {
    accountingError = error;
  }
  const status = terminal?.status;
  if (!terminal || terminalType === "error" || terminalType === "response.failed" || status === "failed")
    throw new NativeCodexResponseError("Codex native compaction request failed", usage);
  if (terminalType === "response.cancelled" || status === "cancelled")
    throw new NativeCodexResponseError("Codex native compaction request was cancelled", usage);
  if (
    failure ||
    terminalType === "response.incomplete" ||
    status === "incomplete" ||
    (terminalType !== "response.completed" && terminalType !== "response.done") ||
    (status !== undefined && status !== "completed")
  )
    throw new NativeCodexResponseError("Codex native compaction did not complete", usage);
  const output = terminal.output;
  const outputItems = Array.isArray(output) ? output.filter(isCodexCompactionItem) : [];
  if (!Array.isArray(output) || outputItems.length !== output.length) mixed = true;
  const first =
    Array.isArray(output) && output.length === 0 && doneItems.length === 1
      ? structuredClone(doneItems[0]!)
      : outputItems.length === 1
        ? structuredClone(outputItems[0]!)
        : undefined;
  // output_item.done and the terminal output are two representations of the
  // same item. Repetition across those representations is valid; the final
  // output array must contain exactly one opaque item, or be empty when the
  // sole item was delivered through output_item.done (stream-only responses).
  if (!first || doneItems.some((item) => !isDeepStrictEqual(item, first)))
    throw new NativeCodexResponseError(
      `Codex native compaction returned an invalid opaque item set (terminal=${Array.isArray(output) ? output.length : "missing"}, streamed=${doneItems.length})`,
      usage,
    );
  if (mixed)
    throw new NativeCodexResponseError("Codex native compaction returned unsupported additional output", usage);
  if (accountingError)
    throw new NativeCodexResponseError(
      accountingError instanceof Error
        ? accountingError.message
        : "Codex native compaction returned invalid accounting",
    );
  if (!usage) throw new NativeCodexResponseError("Codex native compaction returned no usable accounting");
  return { item: first, usage };
}
const MAX_NATIVE_RESPONSE_BYTES = 8 * 1024 * 1024;
function decodeSseBlock(lines: readonly string[]): unknown | undefined {
  const data = lines
    .flatMap((line) => (line === "data" ? [""] : line.startsWith("data:") ? [line.slice(5).replace(/^ /, "")] : []))
    .join("\n");
  if (!data || data === "[DONE]") return;
  try {
    return JSON.parse(data);
  } catch {
    throw new Error("Codex native compaction returned malformed event data");
  }
}
function isTerminalEvent(event: unknown): boolean {
  return (
    isRecord(event) &&
    (event.type === "error" ||
      event.type === "response.completed" ||
      event.type === "response.done" ||
      event.type === "response.failed" ||
      event.type === "response.cancelled" ||
      event.type === "response.incomplete")
  );
}
async function consumeNativeCodexEvents(
  response: Response,
  model: Model<any>,
  signal?: AbortSignal,
): Promise<NativeResponse> {
  if (!response.body) throw new Error("Codex native compaction returned no response body");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    size = 0,
    ended = false;
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const events: unknown[] = [],
    blockLines: string[] = [];
  const accept = (): NativeResponse | undefined => {
    const event = decodeSseBlock(blockLines);
    blockLines.length = 0;
    if (event === undefined) return;
    events.push(event);
    return isTerminalEvent(event) ? parseNativeCodexEvents(events, model) : undefined;
  };
  const consumeLines = (eof = false): NativeResponse | undefined => {
    let offset = 0;
    while (offset < buffer.length) {
      let end = offset;
      while (end < buffer.length && buffer[end] !== "\r" && buffer[end] !== "\n") end++;
      if (end === buffer.length) break;
      if (buffer[end] === "\r" && end + 1 === buffer.length && !eof) break; // CR may be half of CRLF.
      const line = buffer.slice(offset, end);
      const width = buffer[end] === "\r" && buffer[end + 1] === "\n" ? 2 : 1;
      offset = end + width;
      if (line === "") {
        const result = accept();
        if (result) {
          buffer = buffer.slice(offset);
          return result;
        }
      } else blockLines.push(line);
    }
    buffer = buffer.slice(offset);
    if (eof) {
      if (buffer) {
        blockLines.push(buffer);
        buffer = "";
      }
      if (blockLines.length) return accept();
    }
  };
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        ended = true;
        buffer += decoder.decode();
        const result = consumeLines(true);
        if (result) return result;
        return parseNativeCodexEvents(events, model);
      }
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_NATIVE_RESPONSE_BYTES) throw new Error("Codex native compaction response exceeded the size limit");
      buffer += decoder.decode(value, { stream: true });
      const result = consumeLines();
      if (result) return result;
    }
  } finally {
    // A terminal event is sufficient: do not wait for EOF (or a reset) from the server.
    signal?.removeEventListener("abort", abort);
    if (!ended) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function accountIdFromToken(token: string): string {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw 0;
    const claim = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    const id = claim?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    if (typeof id !== "string" || !id) throw 0;
    return id;
  } catch {
    throw new Error("Failed to extract accountId from token");
  }
}
export function buildCodexCompactionHeaders(
  captured: Record<string, string | null>,
  model: Model<any>,
  auth?: { apiKey?: string; headers?: Record<string, string | null> },
): Headers {
  const headers = new Headers(model.headers);
  for (const source of [auth?.headers ?? {}, captured])
    for (const [name, value] of Object.entries(source))
      value === null ? headers.delete(name) : headers.set(name, value);
  if (auth?.apiKey) {
    headers.set("Authorization", `Bearer ${auth.apiKey}`);
    headers.set("chatgpt-account-id", accountIdFromToken(auth.apiKey));
  }
  if (!headers.has("Authorization") || !headers.has("chatgpt-account-id"))
    throw new Error("Codex native compaction has no usable OAuth authentication");
  for (const name of [
    "host",
    "content-length",
    "connection",
    "upgrade",
    "sec-websocket-key",
    "sec-websocket-version",
    "sec-websocket-extensions",
  ])
    headers.delete(name);
  headers.set("originator", "pi");
  headers.set("User-Agent", getPiUserAgent());
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  headers.set("OpenAI-Beta", "responses=experimental");
  return headers;
}
export async function requestNativeCodexCompaction(args: {
  model: Model<any>;
  payload: unknown;
  headers: Record<string, string | null>;
  auth?: { apiKey?: string; headers?: Record<string, string | null> };
  signal?: AbortSignal;
  sessionId?: string;
  operationId?: ReturnType<typeof crypto.randomUUID>;
  fetch?: typeof globalThis.fetch;
  onDispatch?: (model: Model<any>) => void;
}): Promise<NativeResponse> {
  args.signal?.throwIfAborted();
  const body = buildNativeCodexRequest(args.payload);
  if (!body) throw new Error("Codex native compaction request is not compatible with the captured payload");
  const headers = buildCodexCompactionHeaders(args.headers, args.model, args.auth);
  const cacheKey = args.sessionId ?? (typeof body.prompt_cache_key === "string" ? body.prompt_cache_key : undefined);
  if (cacheKey) headers.set("session-id", cacheKey);
  headers.set("x-client-request-id", args.operationId ?? crypto.randomUUID());
  const url = resolveCodexResponsesUrl(args.model.baseUrl);
  const init: RequestInit = { method: "POST", headers, body: JSON.stringify(body), signal: args.signal };
  args.signal?.throwIfAborted();
  // A synchronous fetch throw is not evidence that a request left the process.
  let pending: Promise<Response>;
  try {
    pending = (args.fetch ?? globalThis.fetch)(url, init);
  } catch (error) {
    throw error;
  }
  args.onDispatch?.(args.model);
  const response = await pending;
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new NativeCodexHttpError(response.status);
  }
  return consumeNativeCodexEvents(response, args.model, args.signal);
}
function sameIdentity(c: CapturedRequest, event: SessionBeforeCompactEvent, ctx: ExtensionContext): boolean {
  return (
    !event.signal.aborted &&
    c.sessionId === ctx.sessionManager.getSessionId() &&
    c.leafId !== null &&
    event.branchEntries.some((e) => e.id === c.leafId) &&
    c.model.api === "openai-codex-responses" &&
    ctx.model?.api === c.model.api &&
    ctx.model?.provider === c.model.provider &&
    ctx.model?.id === c.model.id &&
    c.thinkingLevel === (ctx.thinkingLevel ?? null)
  );
}
function coversDiscardedMessages(c: CapturedRequest, event: SessionBeforeCompactEvent): boolean {
  const required = [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages].map((m) =>
    JSON.stringify(m),
  );
  const available = c.messages.map((m) => JSON.stringify(m));
  let at = 0;
  for (const message of required) {
    at = available.indexOf(message, at);
    if (at < 0) return false;
    at++;
  }
  const boundary = event.branchEntries.findIndex((e) => e.id === event.preparation.firstKeptEntryId),
    leaf = event.branchEntries.findIndex((e) => e.id === c.leafId);
  return boundary >= 0 && leaf >= boundary - 1;
}
function nativeAssistant(message: AgentMessage, d: NativeCodexCompactionDetails): AgentMessage {
  return {
    role: "assistant",
    api: d.api,
    provider: d.provider,
    model: d.model,
    content: [{ type: "thinking", thinking: "", thinkingSignature: JSON.stringify(d.item) }],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: message.timestamp,
  } as AgentMessage;
}
function nativeEntriesInContext(ctx: ExtensionContext): CompactionEntry[] {
  return ctx.sessionManager
    .buildContextEntries()
    .filter(
      (e): e is CompactionEntry =>
        e.type === "compaction" && isRecord(e.details) && e.details.strategy === "codex-native",
    );
}
function nativeDetailsInContext(ctx: ExtensionContext): NativeCodexCompactionDetails[] {
  return nativeEntriesInContext(ctx).flatMap((e) => (isNativeCodexCompactionDetails(e.details) ? [e.details] : []));
}
/** Version-pinned bridge for the current pi-ai converter. thinkingSignature is
 * an internal replay carrier, not an assertion that pi-ai officially supports compaction items. */
export function adaptNativeCompactionMessages(messages: AgentMessage[], ctx: ExtensionContext): AgentMessage[] {
  const compactions = ctx.sessionManager.buildContextEntries().filter((e) => e.type === "compaction");
  let index = 0;
  return messages.flatMap((message) => {
    if (message.role !== "compactionSummary") return message;
    const entry = compactions[index++];
    const d = entry?.type === "compaction" ? entry.details : undefined;
    if (
      (message as any).summary !== entry?.summary ||
      !isNativeCodexCompactionDetails(d) ||
      ctx.model?.api !== d.api ||
      ctx.model.provider !== d.provider ||
      ctx.model.id !== d.model
    )
      return message;
    return d.runtimeState
      ? [
          nativeAssistant(message, d),
          { role: "user", content: d.runtimeState, timestamp: message.timestamp } as AgentMessage,
        ]
      : nativeAssistant(message, d);
  });
}
type NativeFallbackCode =
  | "capture_missing"
  | "state_invalid"
  | "identity_stale"
  | "payload_missing"
  | "headers_missing"
  | "payload_incompatible"
  | "coverage_incomplete";

function nativeFallbackCode(
  request: CapturedRequest | undefined,
  invalidated: boolean,
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
): NativeFallbackCode | undefined {
  if (invalidated) return "state_invalid";
  if (!request) return "capture_missing";
  if (!sameIdentity(request, event, ctx)) return "identity_stale";
  if (request.payload === undefined) return "payload_missing";
  if (request.headers === undefined) return "headers_missing";
  if (!buildNativeCodexRequest(request.payload)) return "payload_incompatible";
  if (!coversDiscardedMessages(request, event)) return "coverage_incomplete";
}

function restoreLeaf(manager: ExtensionContext["sessionManager"], priorLeaf: string | null | undefined): void {
  if (priorLeaf === undefined) return;
  try {
    const mutable = manager as unknown as { resetLeaf?: () => void; branch?: (id: string) => void };
    if (priorLeaf === null) mutable.resetLeaf?.();
    else mutable.branch?.(priorLeaf);
  } catch {
    // The owning operation remains conservative if restoring the view fails.
  }
}

function bestEffortDiagnostic(ctx: ExtensionContext, diagnostic: Parameters<typeof recordDiagnostic>[1]): void {
  const priorLeaf = ctx.sessionManager.getLeafId();
  try {
    recordDiagnostic(ctx.sessionManager, diagnostic);
  } catch {
    // Diagnostics are observational.
  } finally {
    restoreLeaf(ctx.sessionManager, priorLeaf);
  }
}

function bestEffortProviderObservation(
  manager: ExtensionContext["sessionManager"],
  model: Pick<Model<any>, "provider" | "id">,
  observedAt: "dispatch" | "response",
  operationId: ReturnType<typeof crypto.randomUUID>,
): void {
  try {
    reportProviderAttempt(manager as object, model, observedAt, Date.now(), operationId);
  } catch {}
}

function persistBillableUsage(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  usage: Usage | undefined,
  status: "failed" | "cancelled",
  operationId: ReturnType<typeof crypto.randomUUID>,
): boolean {
  if (!usage) return true;
  const priorLeaf = ctx.sessionManager.getLeafId();
  try {
    pi.appendEntry(NATIVE_CODEX_USAGE_ENTRY, {
      strategy: "codex-native",
      status,
      usage,
      timestamp: Date.now(),
    });
    return true;
  } catch {
    restoreLeaf(ctx.sessionManager, priorLeaf);
    bestEffortDiagnostic(ctx, {
      component: "observer",
      code: "state_write_failed",
      outcome: "failed",
      operationId,
      dispatch: "response",
    });
    ctx.ui?.notify?.("Compaction usage checkpoint could not be written; compaction cancelled.", "error");
    return false;
  }
}

export function registerNativeCodexCompaction(
  pi: ExtensionAPI,
  pendingJobs: () => readonly { id: string; kind: string; status: string }[] = () => [],
): { invalidateCapture(): void; hasFreshCapture(): boolean } {
  let captured: CapturedRequest | undefined;
  let captureInvalidated = false;
  let blockOrdinaryRequest: string | undefined;
  let generation = 0;
  pi.on("context", (event, ctx) => {
    const entries = nativeEntriesInContext(ctx);
    const invalid = entries.some((e) => !isNativeCodexCompactionDetails(e.details));
    const checkpoints = nativeDetailsInContext(ctx);
    const incompatible = checkpoints.find(
      (d) => ctx.model?.api !== d.api || ctx.model.provider !== d.provider || ctx.model.id !== d.model,
    );
    if (invalid || incompatible) {
      bestEffortDiagnostic(ctx, {
        component: "compaction",
        code: invalid ? "state_invalid" : "identity_stale",
        outcome: "blocked",
        operationId: crypto.randomUUID(),
        dispatch: "none",
        cancellation: "safety",
      });
      blockOrdinaryRequest = invalid
        ? "Unsupported or damaged opaque Codex checkpoint. Use a compatible die version or branch before the checkpoint."
        : "This session contains an opaque Codex checkpoint that cannot be sent to the selected provider/model. Switch back to " +
          incompatible!.provider +
          "/" +
          incompatible!.model +
          " or start a new session.";
      ctx.ui?.notify?.(blockOrdinaryRequest, "error");
      ctx.abort();
      return { messages: event.messages };
    }
    blockOrdinaryRequest = undefined;
    if (ctx.model?.api === "openai-codex-responses") {
      captureInvalidated = false;
      captured = {
        sessionId: ctx.sessionManager.getSessionId(),
        leafId: ctx.sessionManager.getLeafId(),
        model: structuredClone(ctx.model),
        thinkingLevel: ctx.thinkingLevel ?? null,
        messages: structuredClone(event.messages),
      };
    }
    return { messages: adaptNativeCompactionMessages(event.messages, ctx) };
  });
  pi.on("before_provider_headers", (event) => {
    if (captured) captured.headers = { ...event.headers };
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (blockOrdinaryRequest) throw new Error(blockOrdinaryRequest);
    const native = nativeDetailsInContext(ctx),
      payload = event.payload;
    const input = isRecord(payload) && Array.isArray(payload.input) ? payload.input : [];
    if (native.length && native.some((d) => !input.some((item: unknown) => isDeepStrictEqual(item, d.item)))) {
      bestEffortDiagnostic(ctx, {
        component: "compaction",
        code: "opaque_checkpoint",
        outcome: "blocked",
        operationId: crypto.randomUUID(),
        dispatch: "none",
        cancellation: "safety",
      });
      const message = "Native Codex checkpoint was lost during provider serialization; request cancelled.";
      ctx.ui?.notify?.(message, "error");
      ctx.abort();
      throw new Error(message);
    }
    if (captured) captured.payload = structuredClone(payload);
  });
  pi.on("session_start", () => {
    generation++;
    captured = undefined;
    captureInvalidated = false;
    blockOrdinaryRequest = undefined;
  });
  pi.on("model_select", () => {
    generation++;
    captured = undefined;
    captureInvalidated = false;
  });
  pi.on("thinking_level_select", () => {
    generation++;
    captured = undefined;
    captureInvalidated = false;
  });
  pi.on("session_before_tree", (event, ctx) => {
    if (
      event.preparation.userWantsSummary &&
      (nativeEntriesInContext(ctx).length ||
        event.preparation.entriesToSummarize.some(
          (e) => e.type === "compaction" && isRecord(e.details) && e.details.strategy === "codex-native",
        ))
    ) {
      bestEffortDiagnostic(ctx, {
        component: "compaction",
        code: "opaque_checkpoint",
        outcome: "blocked",
        operationId: crypto.randomUUID(),
        dispatch: "none",
        cancellation: "safety",
      });
      ctx.ui?.notify?.(
        "Branch summaries cannot yet carry opaque Codex state. Navigate without a summary or branch before the checkpoint.",
        "error",
      );
      return { cancel: true };
    }
  });
  pi.on("session_before_compact", async (event, ctx) => {
    const operationId = crypto.randomUUID();
    const existing = nativeEntriesInContext(ctx);
    if (ctx.model?.api !== "openai-codex-responses") {
      if (existing.length) {
        bestEffortDiagnostic(ctx, {
          component: "compaction",
          code: "opaque_checkpoint",
          outcome: "blocked",
          operationId,
          dispatch: "none",
          cancellation: "safety",
        });
        ctx.ui?.notify?.("Compaction cancelled: switch back to the checkpoint's original Codex model first.", "error");
        return { cancel: true };
      }
      return;
    }
    const request = captured;
    if (event.customInstructions?.trim()) {
      if (existing.length) {
        bestEffortDiagnostic(ctx, {
          component: "compaction",
          code: "custom_instructions",
          outcome: "blocked",
          operationId,
          dispatch: "none",
          cancellation: "safety",
        });
        ctx.ui?.notify?.(
          "Custom compaction cannot safely rewrite an opaque Codex checkpoint; compaction cancelled.",
          "error",
        );
        return { cancel: true };
      }
      bestEffortDiagnostic(ctx, {
        component: "compaction",
        code: "custom_instructions",
        outcome: "fallback",
        operationId,
        dispatch: "none",
      });
      captured = undefined;
      ctx.ui?.notify?.(
        "Codex native compaction does not support custom instructions; trying cache-affine plaintext compaction.",
        "warning",
      );
      return;
    }
    const fallbackCode = nativeFallbackCode(request, captureInvalidated, event, ctx);
    if (fallbackCode) {
      const outcome = existing.length ? "blocked" : "fallback";
      bestEffortDiagnostic(ctx, {
        component: "compaction",
        code: fallbackCode,
        outcome,
        operationId,
        dispatch: "none",
        ...(existing.length ? { cancellation: "safety" as const } : {}),
      });
      if (existing.length) {
        ctx.ui?.notify?.(
          "No safe native request covers every message that would be discarded; opaque checkpoint preserved and compaction cancelled.",
          "error",
        );
        return { cancel: true };
      }
      captured = undefined;
      const descriptions: Record<NativeFallbackCode, string> = {
        capture_missing: "no provider request has been captured",
        state_invalid: "the captured provider request was invalidated",
        identity_stale: "the captured session, branch, model, or thinking identity is stale",
        payload_missing: "the captured provider payload is missing",
        headers_missing: "the captured provider headers are missing",
        payload_incompatible: "the captured provider payload is incompatible",
        coverage_incomplete: "the captured request does not cover every discarded message",
      };
      ctx.ui?.notify?.(
        "Codex native compaction unavailable: " +
          descriptions[fallbackCode] +
          "; trying cache-affine plaintext compaction.",
        "warning",
      );
      return;
    }

    const readyRequest = request as CapturedRequest & { payload: unknown; headers: Record<string, string | null> };
    const scope = {
      manager: ctx.sessionManager,
      sessionId: ctx.sessionManager.getSessionId(),
      leafId: ctx.sessionManager.getLeafId(),
      api: ctx.model?.api,
      provider: ctx.model?.provider,
      model: ctx.model?.id,
      thinkingLevel: ctx.thinkingLevel ?? null,
      generation,
    };
    const scopeIsCurrent = () =>
      generation === scope.generation &&
      ctx.sessionManager === scope.manager &&
      scope.manager.getSessionId() === scope.sessionId &&
      scope.manager.getLeafId() === scope.leafId &&
      ctx.model?.api === scope.api &&
      ctx.model?.provider === scope.provider &&
      ctx.model?.id === scope.model &&
      (ctx.thinkingLevel ?? null) === scope.thinkingLevel;
    let dispatch: "none" | "initiated" | "response" | "unknown" = "none";
    try {
      const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(readyRequest.model);
      if (!scopeIsCurrent()) return { cancel: true };
      if (!resolved.ok) {
        bestEffortDiagnostic(ctx, {
          component: "provider",
          code: "provider_failed",
          outcome: "failed",
          operationId,
          dispatch: "none",
        });
        ctx.ui?.notify?.(
          "Codex native compaction credentials are unavailable. Compaction cancelled; no plaintext request was sent.",
          "error",
        );
        return { cancel: true };
      }
      for (const [key, value] of Object.entries(readyRequest.headers)) {
        if (
          ["x-api-key", "api-key"].includes(key.toLowerCase()) &&
          !Object.entries(resolved.headers ?? {}).some(
            ([name, current]) => name.toLowerCase() === key.toLowerCase() && current === value,
          )
        ) {
          bestEffortDiagnostic(ctx, {
            component: "provider",
            code: "identity_stale",
            outcome: "blocked",
            operationId,
            dispatch: "none",
            cancellation: "safety",
          });
          ctx.ui?.notify?.(
            "Codex native compaction credentials changed. Compaction cancelled; no plaintext request was sent.",
            "error",
          );
          return { cancel: true };
        }
      }
      const resolvedModel = { ...readyRequest.model, baseUrl: resolved.baseUrl ?? readyRequest.model.baseUrl };
      const native = await requestNativeCodexCompaction({
        model: resolvedModel,
        payload: readyRequest.payload,
        headers: readyRequest.headers,
        auth: { apiKey: resolved.apiKey, headers: resolved.headers },
        sessionId: readyRequest.sessionId,
        operationId,
        signal: event.signal,
        onDispatch: (model) => {
          dispatch = "initiated";
          if (scopeIsCurrent()) bestEffortProviderObservation(scope.manager, model, "dispatch", operationId);
        },
      });
      dispatch = "response";
      if (!scopeIsCurrent()) return { cancel: true };
      // A successful native HTTP response refreshes the same provider cache as
      // ordinary traffic. Rejections and transport failures never reach here.
      bestEffortProviderObservation(scope.manager, readyRequest.model, "response", operationId);
      if (event.signal.aborted) {
        persistBillableUsage(pi, ctx, native.usage, "cancelled", operationId);
        bestEffortDiagnostic(ctx, {
          component: "compaction",
          code: "caller_aborted",
          outcome: "cancelled",
          operationId,
          dispatch: "response",
          cancellation: "caller",
        });
        return { cancel: true };
      }
      const jobs = pendingJobs();
      const runtimeState = jobs.length
        ? jobsTemplate
            .trimEnd()
            .replace("{{jobs}}", () => jobs.map((job) => `- ${job.id}: ${job.kind}, ${job.status}`).join("\n"))
        : undefined;
      const details: NativeCodexCompactionDetails = {
        strategy: "codex-native",
        version: 1,
        api: "openai-codex-responses",
        provider: readyRequest.model.provider,
        model: readyRequest.model.id,
        thinkingLevel: readyRequest.thinkingLevel,
        runtimeState,
        readFiles: [...event.preparation.fileOps.read],
        modifiedFiles: [...new Set([...event.preparation.fileOps.written, ...event.preparation.fileOps.edited])],
        item: native.item,
      };
      const result: CompactionResult<NativeCodexCompactionDetails> = {
        summary: NATIVE_CODEX_SUMMARY + (runtimeState ? "\n\n" + runtimeState : ""),
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        usage: native.usage,
        details,
      };
      return { compaction: result };
    } catch (error) {
      if (!scopeIsCurrent()) return { cancel: true };
      const usage = error instanceof NativeCodexResponseError ? error.usage : undefined;
      const callerCancelled = event.signal.aborted;
      const providerCancelled = error instanceof NativeCodexResponseError && error.message.includes("was cancelled");
      const cancelled = callerCancelled || providerCancelled;
      persistBillableUsage(pi, ctx, usage, cancelled ? "cancelled" : "failed", operationId);
      bestEffortDiagnostic(ctx, {
        component: "provider",
        code: callerCancelled
          ? "caller_aborted"
          : providerCancelled
            ? "provider_cancelled"
            : error instanceof NativeCodexHttpError
              ? "http_rejected"
              : error instanceof NativeCodexResponseError
                ? "response_invalid"
                : "transport_error",
        outcome: cancelled ? "cancelled" : "failed",
        operationId,
        dispatch: error instanceof NativeCodexHttpError ? "response" : dispatch,
        ...(error instanceof NativeCodexHttpError ? { httpStatus: error.status } : {}),
        ...(callerCancelled ? { cancellation: "caller" as const } : {}),
        ...(providerCancelled ? { cancellation: "provider" as const } : {}),
      });
      ctx.ui?.notify?.(
        cancelled
          ? "Codex native compaction was cancelled; no plaintext request was sent."
          : "Codex native compaction failed. Compaction cancelled; no plaintext request was sent.",
        "error",
      );
      return { cancel: true };
    }
  });
  return {
    invalidateCapture() {
      generation++;
      captured = undefined;
      captureInvalidated = true;
    },
    hasFreshCapture() {
      return (
        !captureInvalidated &&
        captured?.payload !== undefined &&
        captured.headers !== undefined &&
        buildNativeCodexRequest(captured.payload) !== undefined
      );
    },
  };
}
