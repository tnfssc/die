import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type LiveBridgeEvent =
  | { type: "accepted"; requestId: string }
  | { type: "tool_started"; requestId: string; toolCallId: string; toolName: string }
  | { type: "tool_finished"; requestId: string; toolCallId: string; toolName: string; isError: boolean }
  | { type: "assistant_reply"; requestId: string; text: string; truncated: boolean }
  | { type: "turn_ended"; requestId: string; outcome: "completed" | "aborted" | "error" };

export type LiveBridgeCallback = (event: LiveBridgeEvent) => void;

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
  /** Requests retained at once, including accepted requests waiting for their turn. */
  maxActive?: number;
  /** Recently retired IDs retained to make retries idempotent. */
  maxRecentIds?: number;
  /** Maximum input size retained by the bridge. */
  maxMessageChars?: number;
  /** Maximum assistant text included in one event. */
  maxReplyChars?: number;
}

export interface CurrentSessionBridge {
  /**
   * Queue work in the already configured Pi session. This method is synchronous;
   * a queued result is only a local acknowledgement. Acceptance and activity are
   * reported later through onEvent.
   */
  handoff(input: LiveHandoff): LiveHandoffResult;
  /** Stop reporting this request. This never aborts the Pi agent. */
  cancel(requestId: string): boolean;
  /** Detach the bridge and discard its bounded tracking state. Never aborts Pi. */
  stop(): void;
  readonly activeCount: number;
}

type RequestState = "awaiting_acceptance" | "accepted" | "active";
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
      continue;
    }
    if (value.length > remaining) {
      text += value.slice(0, remaining);
      truncated = true;
    } else {
      text += value;
    }
  }
  // Avoid returning half of a UTF-16 surrogate pair at the truncation boundary.
  if (truncated && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return text.length > 0 || truncated ? { text, truncated } : undefined;
}

/**
 * Connect an external producer to the current Pi session.
 *
 * The bridge deliberately has no model, credential, permission, or abort API.
 * Tool arguments/results are not exposed. In particular, turn_ended means only
 * that Pi emitted a turn boundary; it is not a claim that background work ended.
 */
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
  const awaitingTurn: string[] = [];
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

  const removeQueuedId = (queue: string[], requestId: string) => {
    const index = queue.indexOf(requestId);
    if (index >= 0) queue.splice(index, 1);
  };

  const retire = (requestId: string, suppressPendingEvents = false) => {
    const request = requests.get(requestId);
    if (suppressPendingEvents && request) request.reporting = false;
    requests.delete(requestId);
    removeQueuedId(awaitingAcceptance, requestId);
    removeQueuedId(awaitingTurn, requestId);
    if (currentRequestId === requestId) currentRequestId = undefined;
    remember(requestId);
  };

  const emit = (request: TrackedRequest, event: LiveBridgeEvent) => {
    // Pi can synchronously emit input/turn events from sendUserMessage. Deferring
    // guarantees handoff() returns its queue acknowledgement before callbacks.
    queueMicrotask(() => {
      if (stopped || !request.reporting) return;
      try {
        request.callback(event);
      } catch {
        // An integration callback must not disrupt Pi's event dispatch.
      }
    });
  };

  const nextTracked = (queue: string[], state: RequestState): TrackedRequest | undefined => {
    while (queue.length > 0) {
      const requestId = queue.shift();
      if (requestId === undefined) return;
      const request = requests.get(requestId);
      if (request?.state === state) return request;
    }
    return;
  };

  unsubscribe.push(
    pi.on("input", (event) => {
      if (stopped || event.source !== "extension") return;
      // Match both source and exact text. We never infer acceptance from an
      // unrelated agent lifecycle event.
      const index = awaitingAcceptance.findIndex((requestId) => {
        const request = requests.get(requestId);
        return request?.state === "awaiting_acceptance" && request.message === event.text;
      });
      if (index < 0) return;
      const [requestId] = awaitingAcceptance.splice(index, 1);
      if (requestId === undefined) return;
      const request = requests.get(requestId);
      if (request?.state !== "awaiting_acceptance") return;
      request.state = "accepted";
      awaitingTurn.push(requestId);
      emit(request, { type: "accepted", requestId });
    }),
  );

  unsubscribe.push(
    pi.on("turn_start", () => {
      if (stopped || currentRequestId !== undefined) return;
      const request = nextTracked(awaitingTurn, "accepted");
      if (!request) return;
      request.state = "active";
      currentRequestId = request.requestId;
    }),
  );

  unsubscribe.push(
    pi.on("tool_execution_start", (event) => {
      const request = currentRequestId ? requests.get(currentRequestId) : undefined;
      if (!request) return;
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
      const request = currentRequestId ? requests.get(currentRequestId) : undefined;
      if (!request) return;
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
    pi.on("message_end", (event) => {
      const request = currentRequestId ? requests.get(currentRequestId) : undefined;
      if (!request) return;
      const reply = boundedText(event.message, maxReplyChars);
      if (!reply) return;
      emit(request, { type: "assistant_reply", requestId: request.requestId, ...reply });
    }),
  );

  unsubscribe.push(
    pi.on("turn_end", (event) => {
      const request = currentRequestId ? requests.get(currentRequestId) : undefined;
      if (!request) return;
      emit(request, { type: "turn_ended", requestId: request.requestId, outcome: event.outcome });
    }),
  );

  unsubscribe.push(
    pi.on("agent_end", () => {
      // agent_end is only used to release the current association. It is not
      // forwarded as completion: handed-off/background work may still exist.
      if (currentRequestId !== undefined) retire(currentRequestId);
    }),
  );

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const off of unsubscribe.splice(0)) off();
    for (const request of requests.values()) request.reporting = false;
    requests.clear();
    awaitingAcceptance.length = 0;
    awaitingTurn.length = 0;
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
      ) {
        return { status: "invalid", requestId, reason: "request_id" };
      }
      if (typeof message !== "string" || message.trim().length === 0 || message.length > maxMessageChars) {
        return { status: "invalid", requestId, reason: "message" };
      }
      const duplicate = requests.get(requestId);
      if (duplicate) {
        // A transport retry may provide a replacement callback, but never sends
        // the user message twice.
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
      try {
        // followUp preserves current work; this is never a steering/audio-stop
        // operation. Pi uses its existing session/model/auth/tool permissions.
        pi.sendUserMessage(message, { deliverAs: "followUp", expandPromptTemplates: false });
      } catch {
        request.reporting = false;
        requests.delete(requestId);
        removeQueuedId(awaitingAcceptance, requestId);
        return { status: "rejected", requestId, reason: "send_failed" };
      }
      return { status: "queued", requestId };
    },
    cancel(requestId: string): boolean {
      if (!requests.has(requestId)) return false;
      // This cancels only event association. Agent cancellation is an explicit,
      // separate concern and is intentionally unavailable through this bridge.
      retire(requestId, true);
      return true;
    },
    stop,
    get activeCount() {
      return requests.size;
    },
  };
}
