import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type LiveBridgeEvent =
  | { type: "accepted"; requestId: string }
  | { type: "delivery_failed"; requestId: string; reason: "send_failed" }
  | { type: "tool_started"; requestId: string; toolCallId: string; toolName: string }
  | { type: "tool_finished"; requestId: string; toolCallId: string; toolName: string; isError: boolean }
  | { type: "assistant_reply"; requestId: string; text: string; truncated: boolean }
  | { type: "turn_ended"; requestId: string; outcome: "completed" | "aborted" | "error" }
  | { type: "run_ended"; requestId: string };

export type CurrentSessionEvent =
  | { type: "tool_started"; scope: "current_session"; toolCallId: string; toolName: string }
  | { type: "tool_finished"; scope: "current_session"; toolCallId: string; toolName: string; isError: boolean }
  | { type: "assistant_reply"; scope: "current_session"; text: string; truncated: boolean }
  | { type: "turn_ended"; scope: "current_session"; outcome: "completed" | "aborted" | "error" };

export type LiveBridgeCallback = (event: LiveBridgeEvent) => void;
export type CurrentSessionCallback = (event: CurrentSessionEvent) => void;

export type LiveHandoffResult =
  | { status: "queued"; requestId: string }
  | { status: "duplicate"; requestId: string }
  | { status: "full"; requestId: string }
  | { status: "stopped"; requestId: string }
  | { status: "invalid"; requestId: string; reason: "request_id" | "message" }
  | { status: "rejected"; requestId: string; reason: "send_failed" };

export interface LiveHandoff {
  requestId: string;
  message: string;
  onEvent: LiveBridgeCallback;
}

export interface CurrentSessionBridgeOptions {
  maxActive?: number;
  maxRecentIds?: number;
  maxMessageChars?: number;
  maxReplyChars?: number;
  /** Observes the session itself, including unassociated background resumptions. */
  onSessionEvent?: CurrentSessionCallback;
}

export interface CurrentSessionBridge {
  /** A queued result acknowledges only local enqueueing, not Pi acceptance. */
  handoff(input: LiveHandoff): LiveHandoffResult;
  /** Stop reporting this request. This never aborts the Pi agent. */
  cancel(requestId: string): boolean;
  /** Detach the bridge. This never aborts the Pi agent. */
  stop(): void;
  readonly activeCount: number;
}

type RequestState = "awaiting_acceptance" | "active";
interface TrackedRequest {
  requestId: string;
  message: string;
  callback: LiveBridgeCallback;
  state: RequestState;
  reporting: boolean;
}

const DEFAULT_MAX_ACTIVE = 8;
const DEFAULT_MAX_RECENT_IDS = 32;
const DEFAULT_MAX_MESSAGE_CHARS = 16_000;
const DEFAULT_MAX_REPLY_CHARS = 4_000;
const MAX_REQUEST_ID_CHARS = 128;

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

function boundedText(message: unknown, limit: number): { text: string; truncated: boolean } | undefined {
  if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") return;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return;
  let text = "";
  let truncated = false;
  for (const part of content) {
    if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "text") continue;
    const value = (part as { text?: unknown }).text;
    if (typeof value !== "string") continue;
    const remaining = limit - text.length;
    if (remaining <= 0) {
      if (value.length > 0) truncated = true;
    } else if (value.length > remaining) {
      text += value.slice(0, remaining);
      truncated = true;
    } else text += value;
  }
  if (truncated && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return text.length > 0 || truncated ? { text, truncated } : undefined;
}

function userText(message: unknown): string | undefined {
  if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") return;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return;
  let text = "";
  for (const part of content) {
    if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "text") continue;
    const value = (part as { text?: unknown }).text;
    if (typeof value === "string") text += value;
  }
  return text;
}

export function createCurrentSessionBridge(
  pi: ExtensionAPI,
  options: CurrentSessionBridgeOptions = {},
): CurrentSessionBridge {
  const maxActive = positiveInteger(options.maxActive, DEFAULT_MAX_ACTIVE);
  const maxRecentIds = positiveInteger(options.maxRecentIds, DEFAULT_MAX_RECENT_IDS);
  const maxMessageChars = positiveInteger(options.maxMessageChars, DEFAULT_MAX_MESSAGE_CHARS);
  const maxReplyChars = positiveInteger(options.maxReplyChars, DEFAULT_MAX_REPLY_CHARS);
  const requests = new Map<string, TrackedRequest>();
  const awaitingAcceptance: string[] = [];
  const recentIds = new Set<string>();
  const recentOrder: string[] = [];
  const unsubscribe: Array<() => void> = [];
  let currentRequestId: string | undefined;
  let stopped = false;

  const remember = (requestId: string) => {
    if (recentIds.has(requestId)) return;
    recentIds.add(requestId);
    recentOrder.push(requestId);
    while (recentOrder.length > maxRecentIds) {
      const oldest = recentOrder.shift();
      if (oldest !== undefined) recentIds.delete(oldest);
    }
  };
  const removeAwaiting = (requestId: string) => {
    const index = awaitingAcceptance.indexOf(requestId);
    if (index >= 0) awaitingAcceptance.splice(index, 1);
  };
  const retire = (requestId: string, suppress = false) => {
    const request = requests.get(requestId);
    if (suppress && request) request.reporting = false;
    requests.delete(requestId);
    removeAwaiting(requestId);
    if (currentRequestId === requestId) currentRequestId = undefined;
    remember(requestId);
  };
  const dispatch = (callback: (() => void) | undefined) => {
    if (!callback) return;
    queueMicrotask(() => {
      if (stopped) return;
      try {
        callback();
      } catch {
        /* callbacks cannot disrupt Pi dispatch */
      }
    });
  };
  const emit = (request: TrackedRequest, event: LiveBridgeEvent) =>
    dispatch(() => {
      if (request.reporting) request.callback(event);
    });
  const emitSession = (event: CurrentSessionEvent) =>
    dispatch(options.onSessionEvent ? () => options.onSessionEvent?.(event) : undefined);
  const current = () => (currentRequestId ? requests.get(currentRequestId) : undefined);

  // input is only Pi's preflight hook. Acceptance is confirmed by the actual
  // user message entering the transcript below.
  unsubscribe.push(
    pi.on("message_end", (event) => {
      const delivered = userText(event.message);
      if (delivered !== undefined) {
        const index = awaitingAcceptance.findIndex((id) => {
          const request = requests.get(id);
          return request?.state === "awaiting_acceptance" && request.message === delivered;
        });
        if (index < 0) return;
        const requestId = awaitingAcceptance.splice(index, 1)[0];
        const request = requestId === undefined ? undefined : requests.get(requestId);
        if (request?.state !== "awaiting_acceptance") return;
        if (currentRequestId !== undefined && currentRequestId !== requestId) retire(currentRequestId);
        request.state = "active";
        currentRequestId = requestId;
        emit(request, { type: "accepted", requestId });
        return;
      }
      const reply = boundedText(event.message, maxReplyChars);
      if (!reply) return;
      emitSession({ type: "assistant_reply", scope: "current_session", ...reply });
      const request = current();
      if (request) emit(request, { type: "assistant_reply", requestId: request.requestId, ...reply });
    }),
  );

  unsubscribe.push(
    pi.on("tool_execution_start", (event) => {
      emitSession({
        type: "tool_started",
        scope: "current_session",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
      const request = current();
      if (request)
        emit(request, {
          type: "tool_started",
          requestId: request.requestId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        });
    }),
  );
  unsubscribe.push(
    pi.on("tool_execution_end", (event) => {
      emitSession({
        type: "tool_finished",
        scope: "current_session",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
      });
      const request = current();
      if (request)
        emit(request, {
          type: "tool_finished",
          requestId: request.requestId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
        });
    }),
  );
  unsubscribe.push(
    pi.on("turn_end", (event) => {
      emitSession({ type: "turn_ended", scope: "current_session", outcome: event.outcome });
      const request = current();
      if (request) emit(request, { type: "turn_ended", requestId: request.requestId, outcome: event.outcome });
    }),
  );
  unsubscribe.push(
    pi.on("agent_end", () => {
      const request = current();
      if (!request) return;
      emit(request, { type: "run_ended", requestId: request.requestId });
      retire(request.requestId);
    }),
  );

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const off of unsubscribe.splice(0)) off();
    for (const request of requests.values()) request.reporting = false;
    requests.clear();
    awaitingAcceptance.length = 0;
    currentRequestId = undefined;
    recentIds.clear();
    recentOrder.length = 0;
  };
  unsubscribe.push(pi.on("session_shutdown", stop));

  return {
    handoff({ requestId, message, onEvent }): LiveHandoffResult {
      if (stopped) return { status: "stopped", requestId };
      if (
        typeof requestId !== "string" ||
        requestId.length === 0 ||
        requestId.length > MAX_REQUEST_ID_CHARS ||
        !/^[A-Za-z0-9._:-]+$/.test(requestId)
      )
        return { status: "invalid", requestId, reason: "request_id" };
      if (typeof message !== "string" || message.trim().length === 0 || message.length > maxMessageChars)
        return { status: "invalid", requestId, reason: "message" };
      const duplicate = requests.get(requestId);
      if (duplicate) {
        if (typeof onEvent === "function") duplicate.callback = onEvent;
        return { status: "duplicate", requestId };
      }
      if (recentIds.has(requestId)) return { status: "duplicate", requestId };
      if (requests.size >= maxActive) return { status: "full", requestId };
      if (typeof onEvent !== "function") return { status: "invalid", requestId, reason: "message" };

      const request: TrackedRequest = {
        requestId,
        message,
        callback: onEvent,
        state: "awaiting_acceptance",
        reporting: true,
      };
      requests.set(requestId, request);
      awaitingAcceptance.push(requestId);
      let delivery: Promise<void>;
      try {
        delivery = Promise.resolve(
          pi.sendUserMessage(message, { deliverAs: "followUp", expandPromptTemplates: false }),
        );
      } catch {
        request.reporting = false;
        requests.delete(requestId);
        removeAwaiting(requestId);
        return { status: "rejected", requestId, reason: "send_failed" };
      }
      // Delivery is intentionally not awaited. Consume rejection and report only
      // a sanitized failure, provided transcript acceptance did not win the race.
      void delivery.catch(() => {
        if (stopped || requests.get(requestId) !== request || request.state !== "awaiting_acceptance") return;
        emit(request, { type: "delivery_failed", requestId, reason: "send_failed" });
        retire(requestId);
      });
      return { status: "queued", requestId };
    },
    cancel(requestId: string): boolean {
      if (!requests.has(requestId)) return false;
      retire(requestId, true);
      return true;
    },
    stop,
    get activeCount() {
      return requests.size;
    },
  };
}
