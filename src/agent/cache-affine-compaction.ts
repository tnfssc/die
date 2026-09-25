import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, Model, Tool } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { adjustMaxTokensForThinking } from "@earendil-works/pi-ai/api/simple-options";
import {
  buildSessionContext,
  convertToLlm,
  type ExtensionAPI,
  type ExtensionContext,
  estimateTokens,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { recordDiagnostic } from "../diagnostics.js";
import promptTemplate from "../prompts/compaction.md" with { type: "text" };
import jobsTemplate from "../prompts/compaction-jobs.md" with { type: "text" };
import { isReadOnlyCompactionContext } from "./native-compaction";
import { withStandardProviderTier } from "./native-fast-mode";

export const CACHE_AFFINE_COMPACTION_VERSION = 5;

type Snapshot = {
  /** Keep this for the old pure request-builder API. Production prepares live state. */
  messages?: AgentMessage[];
  systemPrompt?: string;
  tools?: Tool[];
  leafId: string | null;
  model: Model<any>;
  thinkingLevel: ExtensionContext["thinkingLevel"];
  sessionId: string;
  providerPayload?: unknown;
  headers?: Record<string, string | null>;
};

type PreparedConversation = {
  messages: Message[];
  rawMessages?: Message[];
  systemPrompt: string;
  tools: Tool[];
  thinkingBudget?: number;
  complete: (
    request: CacheAffineRequest,
    maxTokens: number,
    onPayload: (payload: unknown) => unknown,
  ) => Promise<AssistantMessage>;
};

import {
  getInstructionContinuitySession,
  installCurrentConversationAdapter,
  setCurrentInstructionFrame,
} from "./instruction-continuity";

export {
  bindCurrentCompactionSession,
  clearInstructionContinuity,
  installCurrentConversationAdapter,
  scopeInstructionContinuity,
  setCurrentInstructionFrame,
  updateCurrentInstructionFrame,
} from "./instruction-continuity";

async function prepareCurrentConversation(
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
  snapshot?: Snapshot,
): Promise<PreparedConversation | undefined> {
  const session = getInstructionContinuitySession(ctx.sessionManager as object);
  const agent = session?.agent;
  if (!agent || !ctx.model) return undefined;
  // Build from the event's current branch, not agent state or the prior wire
  // capture. In particular this includes tool results completed since the last
  // provider request and preserves the checkpoint's exact branch.
  const branchMessages = buildSessionContext(event.branchEntries).messages;
  const raw = structuredClone(branchMessages);
  const lastUser = [...raw].reverse().find((message) => message.role === "user");
  const prompt = !lastUser
    ? ""
    : typeof lastUser.content === "string"
      ? lastUser.content
      : lastUser.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  const images =
    lastUser && Array.isArray(lastUser.content) ? lastUser.content.filter((part) => part.type === "image") : [];
  // An ordinary request has already run before_agent_start and snapshot records
  // that effective frame. Re-emitting it here can repeat arbitrary extension
  // side effects. Fresh/resumed sessions have no framed snapshot and must run it.
  const hasEffectiveFrame = snapshot?.systemPrompt !== undefined && snapshot.tools !== undefined;
  if (!hasEffectiveFrame && typeof session?._extensionRunner?.emitBeforeAgentStart !== "function") return undefined;
  let start:
    | Awaited<ReturnType<NonNullable<NonNullable<typeof session>["_extensionRunner"]>["emitBeforeAgentStart"]>>
    | undefined;
  if (!hasEffectiveFrame) {
    const selectedToolsBefore = session!._baseSystemPromptOptions.selectedTools;
    start = await session!._extensionRunner!.emitBeforeAgentStart(
      prompt,
      images.length ? images : undefined,
      session!._baseSystemPromptOptions,
    );
    // before_agent_start may either edit selectedTools explicitly or use
    // setActiveTools() to change the live loadout. As in AgentSession.prompt(),
    // an explicit selection wins; otherwise reconcile the returned stale copy
    // with the live tool names before _preparePromptAndToolLoadout() applies it.
    const handlerEditedTools =
      start.systemPromptOptions.selectedTools.length !== selectedToolsBefore.length ||
      start.systemPromptOptions.selectedTools.some((name, index) => name !== selectedToolsBefore[index]);
    if (!handlerEditedTools) start.systemPromptOptions.selectedTools = session!.getActiveToolNames();
  }
  // Match AgentSession's framing order. Fresh compaction must prepare the same
  // structured system delta that prompt() would have persisted for a normal turn.
  if (start) {
    session!._runSystemPromptOptions = start.systemPromptOptions;
    const update = session!._preparePromptAndToolLoadout(start.systemPromptOptions, raw);
    if (update) raw.unshift(update);
  }
  const effectiveSystemPrompt = hasEffectiveFrame ? snapshot!.systemPrompt! : session!.systemPrompt;
  setCurrentInstructionFrame(ctx.sessionManager as object, effectiveSystemPrompt);
  for (const message of start?.messages ?? []) {
    raw.push({
      role: "custom",
      customType: message.customType,
      content: message.content ?? [],
      display: message.display ?? false,
      details: message.details,
      timestamp: Date.now(),
    } as AgentMessage);
  }
  const transformed = agent.transformContext ? await agent.transformContext(raw, event.signal) : raw;
  if (event.signal.aborted) return undefined;
  const converted = await agent.convertToLlm(transformed);
  const tools = agent.state.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  const messages = normalizeContext({
    systemPrompt: effectiveSystemPrompt,
    messages: converted.filter((message) => message.role !== "system"),
    tools,
  }).messages;
  return {
    messages,
    rawMessages: convertToLlm(branchMessages),
    systemPrompt: effectiveSystemPrompt,
    tools,
    thinkingBudget: anthropicThinkingBudget(ctx.model, ctx.thinkingLevel, agent.thinkingBudgets),
    complete: async (request, maxTokens, onPayload) => {
      const stream = await agent.streamFunction(ctx.model!, normalizeContext({ messages: request.messages }), {
        reasoning: ctx.thinkingLevel === "off" ? undefined : ctx.thinkingLevel,
        sessionId: ctx.sessionManager.getSessionId(),
        signal: event.signal,
        transport: agent.transport,
        thinkingBudgets: agent.thinkingBudgets,
        maxRetryDelayMs: agent.maxRetryDelayMs,
        maxTokens,
        onPayload: async (payload: unknown, model: Model<any>) => {
          const normallyTransformed = (agent.onPayload ? await agent.onPayload(payload, model) : undefined) ?? payload;
          return onPayload(normallyTransformed);
        },
        onResponse: agent.onResponse,
      });
      return stream.result();
    },
  };
}

function anthropicThinkingBudget(
  model: Model<any>,
  level: ExtensionContext["thinkingLevel"],
  custom?: { minimal?: number; low?: number; medium?: number; high?: number },
): number {
  if (
    model.api !== "anthropic-messages" ||
    !level ||
    level === "off" ||
    (model as Model<"anthropic-messages">).compat?.forceAdaptiveThinking === true
  )
    return 0;
  return adjustMaxTokensForThinking(undefined, model.maxTokens, level, custom).thinkingBudget;
}

export type CacheAffineRequest = {
  messages: Message[];
  outputTokens: number;
  estimatedInputTokens: number;
};

const textOf = (response: AssistantMessage): string =>
  response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

function sameIdentity(snapshot: Snapshot, event: SessionBeforeCompactEvent, ctx: ExtensionContext): boolean {
  return (
    snapshot.sessionId === ctx.sessionManager.getSessionId() &&
    snapshot.model.provider === ctx.model?.provider &&
    snapshot.model.id === ctx.model?.id &&
    snapshot.thinkingLevel === ctx.thinkingLevel &&
    !event.signal.aborted
  );
}

function activeTools(pi: ExtensionAPI): Tool[] {
  const definitions = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
  return pi.getActiveTools().flatMap((name) => {
    const tool = definitions.get(name);
    return tool ? [{ name: tool.name, description: tool.description, parameters: tool.parameters }] : [];
  });
}

type RequestBuildResult = { request: CacheAffineRequest } | { reason: string };

/** Prepare the current branch with the same context conversion as a normal
 * assistant request. Summarize all prepared history. Pi separately applies its durable
 * retained-tail boundary when it replays the checkpoint. */
function prepareCacheAffineRequest(
  snapshot: Snapshot,
  event: SessionBeforeCompactEvent,
  current: PreparedConversation,
  customInstructions = event.customInstructions,
): RequestBuildResult {
  const { preparation } = event;
  const history = current.messages;
  if (!history.some((message) => message.role !== "system")) return { reason: "the prepared conversation is empty" };
  const custom = customInstructions?.trim() ? "Additional user focus: " + customInstructions.trim() : "";
  // Use a replacement callback so dollar sequences and template-like text in
  // the user-provided focus remain literal data rather than another pass.
  const prompt = promptTemplate.replace("{{customInstructions}}", () => custom).trimEnd();

  const suffixTokens = Math.ceil(prompt.length / 4) + 32;
  // Pi 0.87 includes the instruction/tool frame in the transcript. Count it
  // once, not both as history and again as the separately estimated frame.
  const conversationTokens = (messages: Message[]) =>
    messages.reduce((total, message) => total + (message.role === "system" ? 0 : estimateTokens(message)), 0);
  const transformedTokens = conversationTokens(history);
  const rawTokens = current.rawMessages && conversationTokens(current.rawMessages);
  const transformedGrowth = Math.max(0, transformedTokens - (rawTokens ?? preparation.tokensBefore));
  const reserve = preparation.settings.reserveTokens;
  const frameTokens = Math.max(
    history.reduce((total, message) => total + (message.role === "system" ? estimateTokens(message) : 0), 0),
    Math.ceil((current.systemPrompt.length + JSON.stringify(current.tools).length) / 4) + 128,
  );
  const estimatedInputTokens =
    Math.max(preparation.tokensBefore + transformedGrowth, transformedTokens + frameTokens) + suffixTokens;
  const outputTokens = Math.min(
    snapshot.model.maxTokens,
    Math.floor(reserve * 0.8),
    reserve - suffixTokens - 256,
    snapshot.model.contextWindow - estimatedInputTokens - 256,
  );
  if (outputTokens < 1024) return { reason: "the configured reserve leaves too little summary output space" };
  if (estimatedInputTokens + outputTokens > snapshot.model.contextWindow) {
    return { reason: "the transformed cache-affine request would exceed the model context window" };
  }

  return {
    request: {
      messages: [...history, { role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
      outputTokens,
      estimatedInputTokens,
    },
  };
}

export function buildCacheAffineRequest(
  snapshot: Snapshot,
  event: SessionBeforeCompactEvent,
  customInstructions = event.customInstructions,
): CacheAffineRequest | undefined {
  // Compatibility helper for deterministic request-shape tests. Production does
  // not use this captured context; it calls prepareCurrentConversation above.
  if (
    !snapshot.messages ||
    snapshot.leafId === null ||
    !event.branchEntries.some((entry) => entry.id === snapshot.leafId)
  )
    return undefined;
  const currentRaw = convertToLlm(buildSessionContext(event.branchEntries).messages);
  const priorRaw = convertToLlm(buildSessionContext(event.branchEntries, snapshot.leafId).messages);
  const transformed = convertToLlm(snapshot.messages);
  if (priorRaw.length > currentRaw.length || !jsonEqual(priorRaw, currentRaw.slice(0, priorRaw.length)))
    return undefined;
  if (transformed.length !== priorRaw.length) return undefined;
  const rawSuffix = currentRaw.slice(priorRaw.length);
  if (rawSuffix.length) {
    const safe = rawSuffix.every(
      (message) =>
        message.role === "assistant" &&
        message.content.every((part) => part.type === "text" || part.type === "thinking"),
    );
    if (!safe || !jsonEqual(transformed, priorRaw)) return undefined;
  }
  const history = [...transformed, ...rawSuffix];
  const result = prepareCacheAffineRequest(
    snapshot,
    event,
    {
      messages: normalizeContext({
        systemPrompt: snapshot.systemPrompt,
        messages: history,
        tools: snapshot.tools,
      }).messages,
      rawMessages: currentRaw,
      systemPrompt: snapshot.systemPrompt ?? "",
      tools: snapshot.tools ?? [],
      complete: async () => {
        throw new Error("not available in request-only helper");
      },
    },
    customInstructions,
  );
  return "request" in result ? result.request : undefined;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type CacheMarker = { messageIndex: number; path: string; value: unknown };

function withoutSequenceCacheMetadata(sequence: unknown[]): { sequence: unknown[]; markers: CacheMarker[] } {
  const markers: CacheMarker[] = [];
  const visit = (value: unknown, messageIndex: number, path: string): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, messageIndex, `${path}/${index}`));
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "cache_control" && /^\/content\/\d+(?:\/content\/\d+)*$/.test(path)) {
        markers.push({ messageIndex, path: `${path}/cache_control`, value: child });
      } else {
        output[key] = visit(child, messageIndex, `${path}/${key}`);
      }
    }
    return output;
  };
  return { sequence: sequence.map((item, index) => visit(item, index, "")), markers };
}

/** Check that provider input with tokens keeps the old wire prefix. Anthropic
 * moves its conversation cache_control marker from the old last user block to
 * the new summary request. Allow that move only when the marker count and policy
 * values stay the same. */
export function isCacheAffineProviderPayload(previous: unknown, candidate: unknown): boolean {
  if (!previous || !candidate || typeof previous !== "object" || typeof candidate !== "object") return false;
  const before = previous as Record<string, unknown>;
  const after = candidate as Record<string, unknown>;
  const sequenceKey = Array.isArray(before.messages) ? "messages" : Array.isArray(before.input) ? "input" : undefined;
  if (!sequenceKey || !Array.isArray(after[sequenceKey])) return false;
  const oldSequence = before[sequenceKey] as unknown[];
  const newSequence = after[sequenceKey] as unknown[];
  if (newSequence.length <= oldSequence.length) return false;

  const oldNormalized = withoutSequenceCacheMetadata(oldSequence);
  const newNormalized = withoutSequenceCacheMetadata(newSequence);
  if (!jsonEqual(oldNormalized.sequence, newNormalized.sequence.slice(0, oldSequence.length))) return false;

  // No marker may be invented, removed, or have its retention policy changed.
  const oldPolicies = oldNormalized.markers.map((marker) => marker.value);
  const newPolicies = newNormalized.markers.map((marker) => marker.value);
  if (!jsonEqual(oldPolicies, newPolicies)) return false;
  for (let index = 0; index < oldNormalized.markers.length; index++) {
    const oldMarker = oldNormalized.markers[index]!;
    const newMarker = newNormalized.markers[index]!;
    const unchanged = oldMarker.messageIndex === newMarker.messageIndex && oldMarker.path === newMarker.path;
    if (!unchanged && newMarker.messageIndex < oldSequence.length) return false;
  }

  // Compare every other serialized provider option. This validates system/tool
  // cache markers and provider cache identity as well as unknown future fields.
  const ignored = new Set([sequenceKey, "max_tokens", "max_output_tokens", "max_completion_tokens"]);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (!ignored.has(key) && !jsonEqual(before[key], after[key])) return false;
  }
  return true;
}

export function isUsableSummaryResponse(response: AssistantMessage): boolean {
  if (response.stopReason === "error" || response.stopReason === "aborted" || response.stopReason === "length")
    return false;
  if (response.content.some((part) => part.type === "toolCall")) return false;
  return textOf(response).length > 0;
}

function bestEffortCompactionDiagnostic(
  ctx: ExtensionContext,
  diagnostic: Parameters<typeof recordDiagnostic>[1],
): void {
  try {
    recordDiagnostic(ctx.sessionManager, diagnostic);
  } catch {}
}

export function registerCacheAffineCompaction(
  pi: ExtensionAPI,
  pendingJobs: () => readonly { id: string; kind: string; status: string }[] = () => [],
  options: { skipCodexNative?: boolean | (() => boolean) } = {},
): void {
  installCurrentConversationAdapter();
  let snapshot: Snapshot | undefined;
  // die's inline extension is loaded after discovered/CLI extensions, so this
  // sees the final chained context and current per-turn system prompt.
  pi.on("context", (event, ctx) => {
    if (!ctx.model || isReadOnlyCompactionContext()) return;
    const same =
      snapshot?.sessionId === ctx.sessionManager.getSessionId() &&
      snapshot.model.provider === ctx.model.provider &&
      snapshot.model.id === ctx.model.id &&
      snapshot.thinkingLevel === ctx.thinkingLevel;
    snapshot = {
      messages: structuredClone(event.messages),
      systemPrompt: ctx.getSystemPrompt(),
      tools: activeTools(pi),
      leafId: ctx.sessionManager.getLeafId(),
      model: ctx.model,
      thinkingLevel: ctx.thinkingLevel,
      sessionId: ctx.sessionManager.getSessionId(),
      ...(same ? { providerPayload: snapshot!.providerPayload, headers: snapshot!.headers } : {}),
    };
  });
  // This hook runs last as part of die's inline extension and therefore records
  // the actual provider payload after earlier payload rewrites.
  pi.on("before_provider_headers", (event) => {
    if (snapshot) snapshot.headers = { ...event.headers };
  });
  pi.on("before_provider_request", (event) => {
    if (snapshot) snapshot.providerPayload = structuredClone(event.payload);
  });
  pi.on("session_start", () => {
    snapshot = undefined;
  });
  pi.on("model_select", () => {
    snapshot = undefined;
  });
  pi.on("thinking_level_select", () => {
    snapshot = undefined;
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const operationId = crypto.randomUUID();
    // Skip only while the native hook owns this event. On an explicit native
    // fallback it clears its capture, allowing this cache-affine path to run.
    const skipCodexNative =
      typeof options.skipCodexNative === "function" ? options.skipCodexNative() : options.skipCodexNative;
    if (skipCodexNative && ctx.model?.api === "openai-codex-responses") return;
    const captured: Snapshot | undefined =
      snapshot && sameIdentity(snapshot, event, ctx)
        ? snapshot
        : ctx.model
          ? {
              leafId: ctx.sessionManager.getLeafId(),
              model: ctx.model,
              thinkingLevel: ctx.thinkingLevel,
              sessionId: ctx.sessionManager.getSessionId(),
            }
          : undefined;
    if (event.signal.aborted) {
      bestEffortCompactionDiagnostic(ctx, {
        component: "compaction",
        code: "caller_aborted",
        outcome: "cancelled",
        operationId,
        dispatch: "none",
        cancellation: "caller",
      });
      return { cancel: true };
    }
    if (!captured || !sameIdentity(captured, event, ctx)) {
      bestEffortCompactionDiagnostic(ctx, {
        component: "compaction",
        code: "identity_stale",
        outcome: "blocked",
        operationId,
        dispatch: "none",
        cancellation: "safety",
      });
      ctx.ui?.notify?.(
        "Cache-affine compaction unavailable: model, thinking, or session identity changed. Compaction cancelled; conversation preserved.",
        "warning",
      );
      return { cancel: true };
    }
    let current: PreparedConversation | undefined;
    try {
      current = await prepareCurrentConversation(event, ctx, captured);
    } catch {
      if (event.signal.aborted) {
        bestEffortCompactionDiagnostic(ctx, {
          component: "compaction",
          code: "caller_aborted",
          outcome: "cancelled",
          operationId,
          dispatch: "none",
          cancellation: "caller",
        });
        return { cancel: true };
      }
      bestEffortCompactionDiagnostic(ctx, {
        component: "compaction",
        code: "preparation_failed",
        outcome: "blocked",
        operationId,
        dispatch: "none",
        cancellation: "safety",
      });
      ctx.ui?.notify?.(
        "Cache-affine compaction unavailable: current context preparation failed. Compaction cancelled; conversation preserved.",
        "warning",
      );
      return { cancel: true };
    }
    if (event.signal.aborted) {
      bestEffortCompactionDiagnostic(ctx, {
        component: "compaction",
        code: "caller_aborted",
        outcome: "cancelled",
        operationId,
        dispatch: "none",
        cancellation: "caller",
      });
      return { cancel: true };
    }
    if (!current) {
      const reason = "this Pi runtime has no current-context preparation seam";
      bestEffortCompactionDiagnostic(ctx, {
        component: "compaction",
        code: "preparation_failed",
        outcome: "blocked",
        operationId,
        dispatch: "none",
        cancellation: "safety",
      });
      ctx.ui?.notify?.(
        `Cache-affine compaction unavailable: ${reason}. Compaction cancelled; conversation preserved.`,
        "warning",
      );
      return { cancel: true };
    }
    const prepared = prepareCacheAffineRequest(captured, event, current);
    if (!("request" in prepared)) {
      bestEffortCompactionDiagnostic(ctx, {
        component: "compaction",
        code: "capacity_insufficient",
        outcome: "blocked",
        operationId,
        dispatch: "none",
        cancellation: "safety",
      });
      ctx.ui?.notify?.(
        `Cache-affine compaction unavailable: ${prepared.reason}. Compaction cancelled; conversation preserved.`,
        "warning",
      );
      return { cancel: true };
    }
    const request = prepared.request;
    // Anthropic simple options add the ordinary reasoning budget to maxTokens.
    // Derive it from the current runtime (including fresh requests), then also
    // validate the final post-hook wire ceiling below.
    const answerTokens = Math.min(
      request.outputTokens,
      captured.model.contextWindow - request.estimatedInputTokens - (current.thinkingBudget ?? 0) - 256,
    );
    if (answerTokens < 1024) {
      bestEffortCompactionDiagnostic(ctx, {
        component: "compaction",
        code: "capacity_insufficient",
        outcome: "blocked",
        operationId,
        dispatch: "none",
        cancellation: "safety",
      });
      ctx.ui?.notify?.(
        "Cache-affine compaction unavailable: insufficient space for unchanged thinking and summary output. Compaction cancelled; conversation preserved.",
        "warning",
      );
      return { cancel: true };
    }
    let responseUsageRecorded = false;
    let paidResponse: AssistantMessage | undefined;
    const recordFailedUsage = (): boolean => {
      if (responseUsageRecorded || !paidResponse || paidResponse.usage.totalTokens <= 0) return true;
      // Mark first: a failing append must not be retried by the surrounding catch.
      responseUsageRecorded = true;
      try {
        pi.appendEntry("die-compaction-attempt", {
          strategy: "cache-affine-plaintext",
          stopReason: paidResponse.stopReason,
          usage: paidResponse.usage,
        });
        return true;
      } catch {
        try {
          recordDiagnostic(ctx.sessionManager, {
            component: "observer",
            code: "state_write_failed",
            outcome: "failed",
            operationId,
            dispatch: "response",
          });
        } catch {}
        ctx.ui?.notify?.("Compaction usage checkpoint could not be written; compaction cancelled.", "error");
        return false;
      }
    };
    let payloadAccepted = false;
    let prefixRejection: string | undefined;
    let priorPayloadAffine: boolean | undefined;
    try {
      const response = await withStandardProviderTier(ctx.sessionManager as object, () =>
        current.complete(request, answerTokens, (payload: unknown) => {
          // A prior wire request is evidence for prefix reuse, not permission to
          // prepare the current conversation. When available, compare it here.
          // Old capture affinity is diagnostic only. Current system, tools,
          // context transforms, and redactions are allowed to differ legitimately.
          priorPayloadAffine =
            captured.providerPayload === undefined
              ? undefined
              : isCacheAffineProviderPayload(captured.providerPayload, payload);
          const wire = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
          const wireCeiling = Number(wire?.max_tokens ?? wire?.max_output_tokens ?? wire?.max_completion_tokens);
          if (
            Number.isFinite(wireCeiling) &&
            request.estimatedInputTokens + wireCeiling + 256 > captured.model.contextWindow
          ) {
            prefixRejection = "final provider output and thinking ceiling exceeds the model context window";
            throw new Error(prefixRejection);
          }
          payloadAccepted = true;
          return payload;
        }),
      );
      paidResponse = response;
      if (event.signal.aborted) {
        recordFailedUsage();
        bestEffortCompactionDiagnostic(ctx, {
          component: "compaction",
          code: "caller_aborted",
          outcome: "cancelled",
          operationId,
          dispatch: "response",
          cancellation: "caller",
        });
        return { cancel: true };
      }
      if (!payloadAccepted && prefixRejection) {
        bestEffortCompactionDiagnostic(ctx, {
          component: "provider",
          code: "capacity_insufficient",
          outcome: "blocked",
          operationId,
          dispatch: "none",
          cancellation: "safety",
        });
        ctx.ui?.notify?.(
          `Cache-affine compaction rejected before inference: ${prefixRejection}. Compaction cancelled; conversation preserved.`,
          "warning",
        );
        return { cancel: true };
      }
      if (!isUsableSummaryResponse(response)) {
        recordFailedUsage();
        bestEffortCompactionDiagnostic(ctx, {
          component: "provider",
          code: "response_invalid",
          outcome: response.stopReason === "aborted" ? "cancelled" : "failed",
          operationId,
          dispatch: "response",
          ...(response.stopReason === "aborted" ? { cancellation: "provider" as const } : {}),
        });
        // A response may already be billable. Cancelling is safer than silently
        // launching Pi's fallback summarizer and losing this usage checkpoint.
        ctx.ui?.notify?.(
          "Cache-affine summary was unusable; compaction was cancelled to avoid duplicate inference.",
          "error",
        );
        return { cancel: true };
      }
      const jobs = pendingJobs();
      const runtimeState = jobs.length
        ? "\n\n" +
          jobsTemplate
            .trimEnd()
            .replace("{{jobs}}", () => jobs.map((job) => `- ${job.id}: ${job.kind}, ${job.status}`).join("\n"))
        : "";
      const modified = new Set([...event.preparation.fileOps.written, ...event.preparation.fileOps.edited]);
      return {
        compaction: {
          summary: textOf(response) + runtimeState,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          usage: response.usage,
          details: {
            strategy: "cache-affine-plaintext",
            version: CACHE_AFFINE_COMPACTION_VERSION,
            ...(priorPayloadAffine === undefined ? {} : { priorPayloadAffine }),
            readFiles: [...event.preparation.fileOps.read].filter((path) => !modified.has(path)).sort(),
            modifiedFiles: [...modified].sort(),
          },
        },
      };
    } catch {
      recordFailedUsage();
      const callerCancelled = event.signal.aborted;
      if (prefixRejection && !payloadAccepted && !callerCancelled) {
        bestEffortCompactionDiagnostic(ctx, {
          component: "provider",
          code: "capacity_insufficient",
          outcome: "blocked",
          operationId,
          dispatch: "none",
          cancellation: "safety",
        });
        ctx.ui?.notify?.(
          "Cache-affine compaction rejected before inference: provider output ceiling exceeds the context window. Compaction cancelled; conversation preserved.",
          "warning",
        );
        return { cancel: true };
      }
      bestEffortCompactionDiagnostic(ctx, {
        component: "provider",
        code: callerCancelled ? "caller_aborted" : payloadAccepted ? "provider_failed" : "provider_failed",
        outcome: callerCancelled ? "cancelled" : "failed",
        operationId,
        dispatch: paidResponse ? "response" : payloadAccepted ? "unknown" : "none",
        ...(callerCancelled ? { cancellation: "caller" as const } : {}),
      });
      if (callerCancelled) return { cancel: true };
      if (!payloadAccepted) {
        ctx.ui?.notify?.(
          "Cache-affine compaction rejected before inference. Compaction cancelled; conversation preserved.",
          "warning",
        );
        return { cancel: true };
      }
      // Once a payload was accepted, the provider may have billed the request.
      // Do not silently start a second summarization with no usage checkpoint.
      ctx.ui?.notify?.(
        "Cache-affine compaction failed after inference began. Compaction was cancelled to avoid duplicate inference.",
        "error",
      );
      return { cancel: true };
    }
  });
}
