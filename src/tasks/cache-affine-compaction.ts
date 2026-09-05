import { adjustMaxTokensForThinking } from "@earendil-works/pi-ai/api/simple-options";
import prefixScopeTemplate from "../prompts/compaction-prefix-scope.md" with { type: "text" };
import wholeScopeTemplate from "../prompts/compaction-whole-scope.md" with { type: "text" };
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ImageContent, Message, Model, Tool } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, estimateTokens, type ExtensionAPI, type ExtensionContext, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import promptTemplate from "../prompts/compaction.md" with { type: "text" };

import jobsTemplate from "../prompts/compaction-jobs.md" with { type: "text" };

export const CACHE_AFFINE_COMPACTION_VERSION = 4;

type Snapshot = {
  /** Retained only for the legacy pure request-builder API; production prepares current state. */
  messages?: AgentMessage[];
  systemPrompt?: string;
  tools?: Tool[];
  leafId: string | null;
  model: Model<any>;
  thinkingLevel: ExtensionContext["thinkingLevel"];
  sessionId: string;
  providerPayload?: unknown;
  headers?: Record<string,string | null>;
};

type PreparedConversation = {
  messages: Message[];
  rawMessages?: Message[];
  systemPrompt: string;
  tools: Tool[];
  thinkingBudget?: number;
  complete: (request: CacheAffineRequest, maxTokens: number, onPayload: (payload: unknown) => unknown) => Promise<AssistantMessage>;
};

type ClassicSession = {
  agent: Agent;
  sessionManager: object;
  _buildRuntime(options: unknown): void;
  _systemPromptOverride?: string;
  _runAgentPrompt(messages: unknown): Promise<void>;
  _extensionRunner?: { emitBeforeAgentStart(prompt: string, images: ImageContent[] | undefined, systemPrompt: string, options: unknown): Promise<{messages?: Array<{customType:string;content:unknown[];display?:boolean;details?:unknown}>;systemPrompt?:string}|undefined> };
  _baseSystemPrompt?: string;
  _baseSystemPromptOptions?: unknown;
};

const classicSessions = new WeakMap<object, ClassicSession>();

type InstructionFrame = { sessionId: string; systemPrompt?: string };
// A persisted session id is not an owner identity: two in-memory managers may
// legitimately load the same session. Key by the manager and guard every access
// with its current id so a manager reused for new/resume cannot inherit a frame.
const dieInstructionFrames = new WeakMap<object, InstructionFrame>();

function currentSessionId(sessionManager: object | undefined): string | undefined {
  if (!sessionManager) return undefined;
  const getSessionId = (sessionManager as { getSessionId?: () => string }).getSessionId;
  return typeof getSessionId === "function" ? getSessionId.call(sessionManager) : undefined;
}

function currentInstructionFrame(sessionManager: object | undefined): InstructionFrame | undefined {
  const id = currentSessionId(sessionManager);
  const frame = sessionManager ? dieInstructionFrames.get(sessionManager) : undefined;
  if (frame && frame.sessionId === id) return frame;
  // A SessionManager can change its active session in place. Delete stale state
  // eagerly rather than allowing a later switch back to revive it.
  if (frame && sessionManager) dieInstructionFrames.delete(sessionManager);
  return undefined;
}

/** Mark a session as owned by die. Non-die AgentSessions remain entirely untouched. */
export function scopeInstructionContinuity(sessionManager: object | undefined): void {
  const sessionId = currentSessionId(sessionManager);
  if (!sessionManager || !sessionId) return;
  if (!currentInstructionFrame(sessionManager)) dieInstructionFrames.set(sessionManager, { sessionId });
}

export function clearInstructionContinuity(sessionManager: object | undefined): void {
  if (sessionManager) {
    dieInstructionFrames.delete(sessionManager);
    classicSessions.delete(sessionManager);
  }
}

/** Keep a frame prepared outside AgentSession.prompt(), notably fresh compaction. */
export function setCurrentInstructionFrame(sessionManager: object, systemPrompt: string): boolean {
  const frame = currentInstructionFrame(sessionManager);
  if (!frame) return false;
  frame.systemPrompt = systemPrompt;
  // Pi refreshes tool continuations from this private override, not agent.state.
  // Synchronize it immediately, including compaction within an existing run.
  const owner = classicSessions.get(sessionManager);
  if (owner) {
    owner._systemPromptOverride = systemPrompt;
    owner.agent.state.systemPrompt = systemPrompt;
  }
  return true;
}

/** Rewrite a prepared frame after a session-scoped instruction change. */
export function updateCurrentInstructionFrame(sessionManager: object, update: (prompt: string) => string): boolean {
  const frame = currentInstructionFrame(sessionManager);
  if (!frame || frame.systemPrompt === undefined) return false;
  return setCurrentInstructionFrame(sessionManager, update(frame.systemPrompt));
}

/** Bind an owning classic session; also usable by embedders with explicit session construction. */
export function bindCurrentCompactionSession(session: ClassicSession): void {
  if (session.sessionManager && typeof session.sessionManager === "object") classicSessions.set(session.sessionManager, session);
}
let classicAdapterInstalled = false;

/**
 * Classic Pi does not expose request preparation or custom-turn framing on its
 * public ExtensionContext. This compatibility adapter therefore monkey-patches
 * the private AgentSession._buildRuntime and _runAgentPrompt seams. It does not
 * patch node_modules on disk or synthesize an agent turn, but it is intentionally
 * version-coupled and must fail visibly if either required seam disappears.
 */
export function installCurrentConversationAdapter(): void {
  if (classicAdapterInstalled) return;
  const prototype = AgentSession.prototype as unknown as ClassicSession;
  const runAgentPrompt = prototype._runAgentPrompt;
  const buildRuntime = prototype._buildRuntime;
  if (typeof runAgentPrompt !== "function" || typeof buildRuntime !== "function") {
    throw new Error("die instruction continuity is unsupported by this Pi runtime: required private AgentSession._runAgentPrompt/_buildRuntime seams are unavailable");
  }
  classicAdapterInstalled = true;
  prototype._runAgentPrompt = async function(this: ClassicSession, messages: unknown) {
      const frame = currentInstructionFrame(this.sessionManager);
      if (frame) {
        // prompt() has already run the entire before_agent_start chain. Capture
        // that final override; custom-message turns have no override, so restore
        // it once for the whole agent loop (including every tool continuation).
        if (this._systemPromptOverride !== undefined) frame.systemPrompt = this._systemPromptOverride;
        else if (frame.systemPrompt !== undefined) {
          this._systemPromptOverride = frame.systemPrompt;
          this.agent.state.systemPrompt = frame.systemPrompt;
        }
      }
      return runAgentPrompt.call(this, messages);
    };
  prototype._buildRuntime = function(this: ClassicSession, options: unknown) {
    bindCurrentCompactionSession(this);
    const result = buildRuntime.call(this, options);
    return result;
  };
}

async function prepareCurrentConversation(event: SessionBeforeCompactEvent, ctx: ExtensionContext, snapshot?: Snapshot): Promise<PreparedConversation | undefined> {
  const session = classicSessions.get(ctx.sessionManager as object);
  const agent = session?.agent;
  if (!agent || !ctx.model) return undefined;
  // Build from the event's current branch, not agent state or the prior wire
  // capture. In particular this includes tool results completed since the last
  // provider request and preserves the checkpoint's exact branch.
  const branchMessages = buildSessionContext(event.branchEntries).messages;
  const raw = structuredClone(branchMessages);
  const lastUser = [...raw].reverse().find(message => message.role === "user");
  const prompt = !lastUser ? "" : typeof lastUser.content === "string" ? lastUser.content
    : lastUser.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  const images = lastUser && Array.isArray(lastUser.content) ? lastUser.content.filter(part => part.type === "image") : [];
  // An ordinary request has already run before_agent_start and snapshot records
  // that effective frame. Re-emitting it here can repeat arbitrary extension
  // side effects. Fresh/resumed sessions have no framed snapshot and must run it.
  const hasEffectiveFrame = snapshot?.systemPrompt !== undefined && snapshot.tools !== undefined;
  const baseSystemPrompt = session?._baseSystemPrompt ?? ctx.getSystemPrompt();
  if (!hasEffectiveFrame && typeof session?._extensionRunner?.emitBeforeAgentStart !== "function") return undefined;
  const start = !hasEffectiveFrame
    ? await session!._extensionRunner!.emitBeforeAgentStart(prompt, images.length ? images : undefined, baseSystemPrompt, session!._baseSystemPromptOptions)
    : undefined;
  // Match AgentSession's framing order exactly, including an explicitly empty
  // prompt returned by a framing hook. Save fresh-compaction framing so the next
  // custom turn and all of its tool continuations reuse it.
  const effectiveSystemPrompt = hasEffectiveFrame ? snapshot!.systemPrompt! : start?.systemPrompt ?? baseSystemPrompt;
  agent.state.systemPrompt = effectiveSystemPrompt;
  setCurrentInstructionFrame(ctx.sessionManager as object, effectiveSystemPrompt);
  for (const message of start?.messages ?? []) {
    raw.push({ role: "custom", customType: message.customType, content: message.content ?? [], display: message.display ?? false, details: message.details, timestamp: Date.now() } as AgentMessage);
  }
  const transformed = agent.transformContext
    ? await agent.transformContext(raw, event.signal)
    : raw;
  if (event.signal.aborted) return undefined;
  const messages = await agent.convertToLlm(transformed);
  const tools = agent.state.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  return {
    messages,
    rawMessages: convertToLlm(branchMessages),
    systemPrompt: effectiveSystemPrompt,
    tools,
    thinkingBudget: anthropicThinkingBudget(ctx.model, ctx.thinkingLevel, agent.thinkingBudgets),
    complete: async (request, maxTokens, onPayload) => {
      const stream = await agent.streamFunction(ctx.model!, {
        systemPrompt: request.systemPrompt,
        messages: request.messages,
        tools: request.tools,
      }, {
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

function anthropicThinkingBudget(model: Model<any>, level: ExtensionContext["thinkingLevel"], custom?: { minimal?: number; low?: number; medium?: number; high?: number }): number {
  if (model.api !== "anthropic-messages" || !level || level === "off" || (model as Model<"anthropic-messages">).compat?.forceAdaptiveThinking === true) return 0;
  return adjustMaxTokensForThinking(undefined, model.maxTokens, level, custom).thinkingBudget;
}

export type CacheAffineRequest = {
  systemPrompt: string;
  messages: Message[];
  tools: Tool[];
  summaryEnd: number;
  tailStart: number;
  outputTokens: number;
  estimatedInputTokens: number;
  summaryScope: "prefix" | "whole-current-conversation";
};

const textOf = (response: AssistantMessage): string => response.content
  .filter((part): part is { type: "text"; text: string } => part.type === "text")
  .map(part => part.text).join("\n").trim();

function sameIdentity(snapshot: Snapshot, event: SessionBeforeCompactEvent, ctx: ExtensionContext): boolean {
  return snapshot.sessionId === ctx.sessionManager.getSessionId()
    && snapshot.model.provider === ctx.model?.provider && snapshot.model.id === ctx.model?.id
    && snapshot.thinkingLevel === ctx.thinkingLevel && !event.signal.aborted;
}

function activeTools(pi: ExtensionAPI): Tool[] {
  const definitions = new Map(pi.getAllTools().map(tool => [tool.name, tool]));
  return pi.getActiveTools().flatMap(name => {
    const tool = definitions.get(name);
    return tool ? [{ name: tool.name, description: tool.description, parameters: tool.parameters }] : [];
  });
}

type RequestBuildResult = { request: CacheAffineRequest } | { reason: string };

export function mapPreparedSummaryBoundary(history: Message[], currentRaw: Message[], discardedNativeCount: number): Pick<CacheAffineRequest, "summaryEnd" | "tailStart" | "summaryScope"> {
  const retainedCount = currentRaw.length - discardedNativeCount;
  const retainedRaw = retainedCount >= 0 ? currentRaw.slice(discardedNativeCount) : [];
  const suffixMapsExactly = retainedCount >= 0 && retainedCount <= history.length
    && jsonEqual(retainedRaw, history.slice(history.length - retainedCount));
  const summaryScope = suffixMapsExactly ? "prefix" : "whole-current-conversation";
  const summaryEnd = suffixMapsExactly ? history.length - retainedCount : history.length;
  return { summaryEnd, tailStart: summaryEnd + 1, summaryScope };
}

/** Prepare the current branch after it has passed through the same context
 * conversion used by an ordinary assistant request. The retained-tail boundary
 * remains Pi's durable checkpoint boundary; it is intentionally independent of
 * the previously captured request. */
function prepareCacheAffineRequest(snapshot: Snapshot, event: SessionBeforeCompactEvent, current: PreparedConversation, customInstructions = event.customInstructions): RequestBuildResult {
  const { preparation } = event;
  const history = current.messages;
  const currentRaw = convertToLlm(buildSessionContext(event.branchEntries).messages);
  const discardedNativeCount = convertToLlm([
    ...preparation.messagesToSummarize,
    ...preparation.turnPrefixMessages,
  ]).length + (preparation.previousSummary ? 1 : 0);
  // Message counts alone carry no provenance through arbitrary context hooks.
  // A prefix boundary is defensible only when the complete retained raw suffix
  // is still the exact prepared suffix. Otherwise summarize all model-facing
  // history; Pi's durable firstKeptEntryId remains authoritative for replay.
  const { summaryEnd, tailStart, summaryScope } = mapPreparedSummaryBoundary(history, currentRaw, discardedNativeCount);
  if (summaryEnd <= 0) return { reason: "the prepared summary scope is empty" };
  const custom = customInstructions?.trim()
    ? "Additional user focus (without changing the durable checkpoint boundary): " + customInstructions.trim()
    : "No additional focus was requested.";
  const scopeFields: Record<string,string> = {summaryEnd:String(summaryEnd),tailStart:String(tailStart),messageCount:String(history.length)};
  const scope = (summaryScope === "prefix" ? prefixScopeTemplate : wholeScopeTemplate).trimEnd()
    .replace(/\{\{(summaryEnd|tailStart|messageCount)\}\}/g, (_match,key:string)=>scopeFields[key]!);
  const fields: Record<string,string> = {scope, customInstructions:custom};
  const prompt = promptTemplate.trimEnd().replace(/\{\{(scope|customInstructions)\}\}/g, (_match,key:string) => fields[key]!);

  const suffixTokens = Math.ceil(prompt.length / 4) + 32;
  const transformedTokens = history.reduce((total, message) => total + estimateTokens(message as AgentMessage), 0);
  const rawTokens = current.rawMessages?.reduce((total, message) => total + estimateTokens(message as AgentMessage), 0);
  const transformedGrowth = Math.max(0, transformedTokens - (rawTokens ?? preparation.tokensBefore));
  const reserve = preparation.settings.reserveTokens;
  const frameTokens = Math.ceil((current.systemPrompt.length + JSON.stringify(current.tools).length) / 4) + 128;
  const estimatedInputTokens = Math.max(preparation.tokensBefore + transformedGrowth, transformedTokens + frameTokens) + suffixTokens;
  const outputTokens = Math.min(snapshot.model.maxTokens, Math.floor(reserve * 0.8), reserve - suffixTokens - 256, snapshot.model.contextWindow - estimatedInputTokens - 256);
  if (outputTokens < 1024) return { reason: "the configured reserve leaves too little summary output space" };
  if (estimatedInputTokens + outputTokens > snapshot.model.contextWindow) {
    return { reason: "the transformed cache-affine request would exceed the model context window" };
  }

  return { request: {
    systemPrompt: current.systemPrompt,
    messages: [...history, { role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
    tools: current.tools,
    summaryEnd, tailStart, outputTokens, estimatedInputTokens, summaryScope,
  } };
}

export function buildCacheAffineRequest(snapshot: Snapshot, event: SessionBeforeCompactEvent, customInstructions = event.customInstructions): CacheAffineRequest | undefined {
  // Compatibility helper for deterministic request-shape tests. Production does
  // not use this captured context; it calls prepareCurrentConversation above.
  if (!snapshot.messages || snapshot.leafId === null || !event.branchEntries.some(entry => entry.id === snapshot.leafId)) return undefined;
  const currentRaw = convertToLlm(buildSessionContext(event.branchEntries).messages);
  const priorRaw = convertToLlm(buildSessionContext(event.branchEntries, snapshot.leafId).messages);
  const transformed = convertToLlm(snapshot.messages);
  if (priorRaw.length > currentRaw.length || !jsonEqual(priorRaw, currentRaw.slice(0, priorRaw.length))) return undefined;
  if (transformed.length !== priorRaw.length) return undefined;
  const rawSuffix = currentRaw.slice(priorRaw.length);
  if (rawSuffix.length) {
    const safe = rawSuffix.every(message => message.role === "assistant" && message.content.every(part => part.type === "text" || part.type === "thinking"));
    if (!safe || !jsonEqual(transformed, priorRaw)) return undefined;
  }
  const history = [...transformed, ...rawSuffix];
  const result = prepareCacheAffineRequest(snapshot, event, {
    messages: history,
    rawMessages: currentRaw,
    systemPrompt: snapshot.systemPrompt ?? "",
    tools: snapshot.tools ?? [],
    complete: async () => { throw new Error("not available in request-only helper"); },
  }, customInstructions);
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

/** Verify that token-bearing provider input retains the old wire prefix.
 * Anthropic intentionally moves its conversation cache_control marker from the
 * old last user block to the newly appended summary request. That relocation is
 * accepted only when the marker count and policy values remain unchanged. */
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
  const oldPolicies = oldNormalized.markers.map(marker => marker.value);
  const newPolicies = newNormalized.markers.map(marker => marker.value);
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
  if (response.stopReason === "error" || response.stopReason === "aborted" || response.stopReason === "length") return false;
  if (response.content.some(part => part.type === "toolCall")) return false;
  return textOf(response).length > 0;
}

export function registerCacheAffineCompaction(pi: ExtensionAPI, pendingJobs: () => readonly {id:string;kind:string;status:string}[] = () => [], options: { skipCodexNative?: boolean } = {}): void {
  installCurrentConversationAdapter();
  let snapshot: Snapshot | undefined;
  // die's inline extension is loaded after discovered/CLI extensions, so this
  // sees the final chained context and current per-turn system prompt.
  pi.on("context", (event, ctx) => {
    if (!ctx.model) return;
    const same = snapshot?.sessionId === ctx.sessionManager.getSessionId()
      && snapshot.model.provider === ctx.model.provider && snapshot.model.id === ctx.model.id
      && snapshot.thinkingLevel === ctx.thinkingLevel;
    snapshot = {
      messages: structuredClone(event.messages), systemPrompt: ctx.getSystemPrompt(), tools: activeTools(pi),
      leafId: ctx.sessionManager.getLeafId(), model: ctx.model,
      thinkingLevel: ctx.thinkingLevel, sessionId: ctx.sessionManager.getSessionId(),
      ...(same ? { providerPayload: snapshot!.providerPayload, headers: snapshot!.headers } : {}),
    };
  });
  // This hook runs last as part of die's inline extension and therefore records
  // the actual provider payload after earlier payload rewrites.
  pi.on("before_provider_headers", event => {
    if (snapshot) snapshot.headers = {...event.headers};
  });
  pi.on("before_provider_request", event => {
    if (snapshot) snapshot.providerPayload = structuredClone(event.payload);
  });
  pi.on("session_start", () => { snapshot = undefined; });
  pi.on("model_select", () => { snapshot = undefined; });
  pi.on("thinking_level_select", () => { snapshot = undefined; });

  pi.on("session_before_compact", async (event, ctx) => {
    // Codex uses the Phase 2 opaque native path. If it is unavailable, leaving
    // this hook empty selects Pi's visibly distinct standard plaintext fallback.
    if (options.skipCodexNative && ctx.model?.api === "openai-codex-responses") return;
    const captured: Snapshot | undefined = snapshot && sameIdentity(snapshot, event, ctx) ? snapshot : ctx.model ? { leafId: ctx.sessionManager.getLeafId(), model: ctx.model, thinkingLevel: ctx.thinkingLevel, sessionId: ctx.sessionManager.getSessionId() } : undefined;
    if (event.signal.aborted) return { cancel: true };
    if (!captured || !sameIdentity(captured, event, ctx)) {
      ctx.ui?.notify?.("Cache-affine compaction unavailable: model, thinking, or session identity changed. Compaction cancelled; conversation preserved.", "warning");
      return { cancel: true };
    }
    let current: PreparedConversation | undefined;
    try {
      current = await prepareCurrentConversation(event, ctx, captured);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      ctx.ui?.notify?.(`Cache-affine compaction unavailable: current context preparation failed: ${reason}. Compaction cancelled; conversation preserved.`, "warning");
      return { cancel: true };
    }
    if (!current) {
      const reason = "this Pi runtime has no current-context preparation seam";
      ctx.ui?.notify?.(`Cache-affine compaction unavailable: ${reason}. Compaction cancelled; conversation preserved.`, "warning");
      return { cancel: true };
    }
    const prepared = prepareCacheAffineRequest(captured, event, current);
    if (!("request" in prepared)) {
      ctx.ui?.notify?.(`Cache-affine compaction unavailable: ${prepared.reason}. Compaction cancelled; conversation preserved.`, "warning");
      return { cancel: true };
    }
    const request = prepared.request;
    // Anthropic simple options add the ordinary reasoning budget to maxTokens.
    // Derive it from the current runtime (including fresh requests), then also
    // validate the final post-hook wire ceiling below.
    const answerTokens = Math.min(request.outputTokens, captured.model.contextWindow - request.estimatedInputTokens - (current.thinkingBudget ?? 0) - 256);
    if (answerTokens < 1024) {
      ctx.ui?.notify?.("Cache-affine compaction unavailable: insufficient space for unchanged thinking and summary output. Compaction cancelled; conversation preserved.", "warning");
      return { cancel: true };
    }
    let responseUsageRecorded = false;
    let paidResponse: AssistantMessage | undefined;
    const recordFailedUsage = () => {
      if (!responseUsageRecorded && paidResponse && paidResponse.usage.totalTokens > 0) {
        responseUsageRecorded = true;
        pi.appendEntry?.("die-compaction-attempt", {strategy:"cache-affine-plaintext", stopReason:paidResponse.stopReason, usage:paidResponse.usage});
      }
    };
    let payloadAccepted = false;
    let prefixRejection: string | undefined;
    let priorPayloadAffine: boolean | undefined;
    try {
      const response = await current.complete(request, answerTokens, (payload: unknown) => {
        // A prior wire request is evidence for prefix reuse, not permission to
        // prepare the current conversation. When available, compare it here.
        // Old capture affinity is diagnostic only. Current system, tools,
        // context transforms, and redactions are allowed to differ legitimately.
        priorPayloadAffine = captured.providerPayload === undefined ? undefined
          : isCacheAffineProviderPayload(captured.providerPayload, payload);
        const wire = payload && typeof payload === "object" ? payload as Record<string, unknown> : undefined;
        const wireCeiling = Number(wire?.max_tokens ?? wire?.max_output_tokens ?? wire?.max_completion_tokens);
        if (Number.isFinite(wireCeiling) && request.estimatedInputTokens + wireCeiling + 256 > captured.model.contextWindow) {
          prefixRejection = "final provider output and thinking ceiling exceeds the model context window";
          throw new Error(prefixRejection);
        }
        payloadAccepted = true;
        return payload;
      });
      paidResponse = response;
      if (event.signal.aborted) { recordFailedUsage(); return { cancel: true }; }
      if (!payloadAccepted && prefixRejection) {
        ctx.ui?.notify?.(`Cache-affine compaction rejected before inference: ${prefixRejection}. Compaction cancelled; conversation preserved.`, "warning");
        return { cancel: true };
      }
      if (!isUsableSummaryResponse(response)) {
        recordFailedUsage();
        // A response may already be billable. Cancelling is safer than silently
        // launching Pi's fallback summarizer and losing this usage checkpoint.
        ctx.ui?.notify?.(`Cache-affine summary was unusable (stop reason: ${response.stopReason}); compaction was cancelled to avoid duplicate inference.`, "error");
        return { cancel: true };
      }
      const jobs = pendingJobs();
      const runtimeState = jobs.length ? "\n\n" + jobsTemplate.trimEnd().replace("{{jobs}}", () => jobs.map(job => `- ${job.id}: ${job.kind}, ${job.status}`).join("\n")) : "";
      const modified = new Set([...event.preparation.fileOps.written, ...event.preparation.fileOps.edited]);
      return { compaction: {
        summary: textOf(response) + runtimeState, firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore, usage: response.usage,
        details: {
          strategy: "cache-affine-plaintext", version: CACHE_AFFINE_COMPACTION_VERSION,
          summaryEnd: request.summaryEnd, tailStart: request.tailStart, summaryScope: request.summaryScope,
          ...(priorPayloadAffine === undefined ? {} : { priorPayloadAffine }),
          readFiles: [...event.preparation.fileOps.read].filter(path => !modified.has(path)).sort(),
          modifiedFiles: [...modified].sort(),
        },
      } };
    } catch (error) {
      recordFailedUsage();
      if (event.signal.aborted) return { cancel: true };
      const reason = error instanceof Error ? error.message : String(error);
      if (!payloadAccepted) {
        ctx.ui?.notify?.(`Cache-affine compaction rejected before inference: ${reason}. Compaction cancelled; conversation preserved.`, "warning");
        return { cancel: true };
      }
      // Once a payload was accepted, the provider may have billed the request.
      // Do not silently start a second summarization with no usage checkpoint.
      ctx.ui?.notify?.(`Cache-affine compaction failed after inference began: ${reason}. Compaction was cancelled to avoid duplicate inference.`, "error");
      return { cancel: true };
    }
  });
}
