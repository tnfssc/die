import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  AgentSession,
  type ExtensionAPI,
  type ExtensionContext,
  estimateTokens,
  type SessionEntry,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { getInstructionContinuitySession } from "./instruction-continuity";

/** Durable, branch-scoped manual context projection. Session JSONL stays append-only. */
export const MANUAL_SHAKE_ENTRY = "die-manual-shake";
export const MANUAL_SHAKE_VERSION = 1;
const MAX_IDS_PER_KIND = 2048;
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_ID_LENGTH = 512;
const MAX_SESSION_ID_LENGTH = 512;

export type ShakeRecord = {
  version: 1;
  sessionId: string;
  assistantEntryIds: string[];
  toolResultEntryIds: string[];
  shakenAt: number;
};
export type ShakePlan = {
  record: ShakeRecord;
  removedAssistantBlocks: number;
  removedToolResults: number;
  unresolvedToolCallIds: string[];
  orphanToolResultIds: string[];
  storageError?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}
function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function uniqueStrings(value: unknown, limit: number): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(validId) && new Set(value).size === value.length;
}
export function isShakeRecord(value: unknown): value is ShakeRecord {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (
    JSON.stringify(keys) !==
    JSON.stringify(["assistantEntryIds", "sessionId", "shakenAt", "toolResultEntryIds", "version"])
  )
    return false;
  return (
    value.version === MANUAL_SHAKE_VERSION &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    value.sessionId.length <= MAX_SESSION_ID_LENGTH &&
    typeof value.shakenAt === "number" &&
    Number.isFinite(value.shakenAt) &&
    value.shakenAt >= 0 &&
    uniqueStrings(value.assistantEntryIds, MAX_IDS_PER_KIND) &&
    uniqueStrings(value.toolResultEntryIds, MAX_IDS_PER_KIND) &&
    serializedBytes(value) <= MAX_RECORD_BYTES
  );
}

export class InvalidShakeRecordError extends Error {
  constructor() {
    super(
      "The latest manual-shake checkpoint is malformed or uses an unsupported version. Refusing to expose unprojected context; branch before that checkpoint or repair/remove the invalid JSONL entry.",
    );
    this.name = "InvalidShakeRecordError";
  }
}

/** The newest marker is authoritative. Forked JSONL copies inherit its projection,
 * but the effective record is rebased to the fork's session identity. */
export function latestShakeRecord(entries: readonly SessionEntry[], sessionId: string): ShakeRecord | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.type !== "custom" || entry.customType !== MANUAL_SHAKE_ENTRY) continue;
    if (!isShakeRecord(entry.data)) throw new InvalidShakeRecordError();
    return entry.data.sessionId === sessionId ? entry.data : { ...entry.data, sessionId };
  }
}
function toolCalls(message: AgentMessage): Array<{ id: string }> {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.flatMap((part) =>
    isRecord(part) && part.type === "toolCall" && validId(part.id) ? [{ id: part.id }] : [],
  );
}
function toolResultId(message: AgentMessage): string | undefined {
  if (message.role !== "toolResult") return;
  const id = (message as AgentMessage & { toolCallId?: unknown }).toolCallId;
  return validId(id) ? id : undefined;
}
function removableAssistantBlockCount(message: AgentMessage): number {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return 0;
  return message.content.filter((part) => isRecord(part) && (part.type === "thinking" || part.type === "toolCall"))
    .length;
}

/** Build a deterministic protocol-paired plan from the active context entries. */
export function buildShakePlan(
  entries: readonly SessionEntry[],
  sessionId: string,
  prior = latestShakeRecord(entries, sessionId),
): ShakePlan {
  const activeEntryIds = new Set(entries.map((entry) => entry.id));
  // Compaction removes old entries from active context. Do not carry their IDs forever.
  const assistantIds = new Set((prior?.assistantEntryIds ?? []).filter((id) => activeEntryIds.has(id)));
  const resultIds = new Set((prior?.toolResultEntryIds ?? []).filter((id) => activeEntryIds.has(id)));
  const calls = new Map<string, { entryId: string; index: number }>();
  const results = new Map<string, { entryId: string; index: number }>();
  const duplicateCalls = new Set<string>();
  const duplicateResults = new Set<string>();
  entries.forEach((entry, index) => {
    if (entry.type !== "message") return;
    if (
      entry.message.role === "assistant" &&
      Array.isArray(entry.message.content) &&
      entry.message.content.some((part) => isRecord(part) && part.type === "toolCall" && !validId(part.id))
    )
      duplicateCalls.add("<invalid-tool-call-id>");
    if (entry.message.role === "toolResult" && !toolResultId(entry.message))
      duplicateResults.add("<invalid-tool-result-id>");
    for (const call of toolCalls(entry.message)) {
      if (calls.has(call.id)) duplicateCalls.add(call.id);
      else calls.set(call.id, { entryId: entry.id, index });
    }
    const resultId = toolResultId(entry.message);
    if (resultId) {
      if (results.has(resultId)) duplicateResults.add(resultId);
      else results.set(resultId, { entryId: entry.id, index });
    }
  });
  const unresolvedToolCallIds = [...calls].flatMap(([id, call]) => {
    const result = results.get(id);
    return !result || result.index <= call.index ? [id] : [];
  });
  const orphanToolResultIds = [...results].flatMap(([id, result]) => {
    const call = calls.get(id);
    return !call || result.index <= call.index ? [id] : [];
  });
  unresolvedToolCallIds.push(...duplicateCalls);
  orphanToolResultIds.push(...duplicateResults);
  let removedAssistantBlocks = 0;
  let removedToolResults = 0;
  if (!unresolvedToolCallIds.length && !orphanToolResultIds.length) {
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const count = removableAssistantBlockCount(entry.message);
      if (count && !assistantIds.has(entry.id)) {
        assistantIds.add(entry.id);
        removedAssistantBlocks += count;
      }
      const resultId = toolResultId(entry.message);
      if (resultId && calls.has(resultId) && !resultIds.has(entry.id)) {
        resultIds.add(entry.id);
        removedToolResults++;
      }
    }
  }
  const record: ShakeRecord = {
    version: MANUAL_SHAKE_VERSION,
    sessionId,
    assistantEntryIds: [...assistantIds],
    toolResultEntryIds: [...resultIds],
    shakenAt: Date.now(),
  };
  const tooMany = assistantIds.size > MAX_IDS_PER_KIND || resultIds.size > MAX_IDS_PER_KIND;
  const tooLarge = serializedBytes(record) > MAX_RECORD_BYTES;
  const invalidRecord = !isShakeRecord(record);
  return {
    record,
    removedAssistantBlocks,
    removedToolResults,
    unresolvedToolCallIds: [...new Set(unresolvedToolCallIds)],
    orphanToolResultIds: [...new Set(orphanToolResultIds)],
    ...(tooMany || tooLarge || invalidRecord
      ? {
          storageError:
            "Shake cannot store a bounded projection for this active window. Compact or branch away old active history, then retry /shake.",
        }
      : {}),
  };
}

type SourceMessage = { entry: SessionEntry; message: AgentMessage; json: string };

/** Match only unambiguous, unchanged incoming occurrences. A redaction or rewrite
 * never causes raw session content to be restored. */
function exactOccurrenceMatches(
  incoming: readonly AgentMessage[],
  source: readonly SourceMessage[],
): Map<number, number> {
  const sourceByJson = new Map<string, number[]>();
  const incomingByJson = new Map<string, number[]>();
  source.forEach((item, index) => {
    const indexes = sourceByJson.get(item.json) ?? [];
    indexes.push(index);
    sourceByJson.set(item.json, indexes);
  });
  incoming.forEach((message, index) => {
    const json = JSON.stringify(message);
    const indexes = incomingByJson.get(json) ?? [];
    indexes.push(index);
    incomingByJson.set(json, indexes);
  });
  const matches = new Map<number, number>();
  for (const [json, sourceIndexes] of sourceByJson) {
    const incomingIndexes = incomingByJson.get(json);
    // Unequal duplicate counts are chronology-ambiguous after an upstream exclusion.
    if (!incomingIndexes || incomingIndexes.length !== sourceIndexes.length) continue;
    sourceIndexes.forEach((sourceIndex, index) => {
      const incomingIndex = incomingIndexes[index];
      if (incomingIndex !== undefined) matches.set(sourceIndex, incomingIndex);
    });
  }
  let previous = -1;
  for (const [, incomingIndex] of [...matches].sort((a, b) => a[0] - b[0])) {
    if (incomingIndex <= previous) return new Map(); // reordered input: preserve everything
    previous = incomingIndex;
  }
  return matches;
}

function projection(
  incoming: readonly AgentMessage[],
  entries: readonly SessionEntry[],
  record: ShakeRecord,
): { messages: AgentMessage[]; removedAssistantBlocks: number; removedToolResults: number } {
  const source: SourceMessage[] = entries.flatMap((entry) =>
    sessionEntryToContextMessages(entry).map((message) => ({ entry, message, json: JSON.stringify(message) })),
  );
  const matches = exactOccurrenceMatches(incoming, source);
  const incomingToSource = new Map([...matches].map(([sourceIndex, incomingIndex]) => [incomingIndex, sourceIndex]));
  const selectedAssistants = new Set(record.assistantEntryIds);
  const selectedResults = new Set(record.toolResultEntryIds);
  const callEntryById = new Map<string, string>();
  const resultEntryById = new Map<string, string>();
  for (const item of source) {
    for (const call of toolCalls(item.message)) callEntryById.set(call.id, item.entry.id);
    const resultId = toolResultId(item.message);
    if (resultId) resultEntryById.set(resultId, item.entry.id);
  }
  const groups = new Map<string, Set<string>>();
  const assistantByResultEntry = new Map<string, string>();
  for (const [id, assistantEntryId] of callEntryById) {
    const resultEntryId = resultEntryById.get(id);
    if (!resultEntryId) continue;
    const group = groups.get(assistantEntryId) ?? new Set([assistantEntryId]);
    group.add(resultEntryId);
    groups.set(assistantEntryId, group);
    assistantByResultEntry.set(resultEntryId, assistantEntryId);
  }
  const sourceIndexesByEntry = new Map<string, number[]>();
  source.forEach((item, index) => {
    const indexes = sourceIndexesByEntry.get(item.entry.id) ?? [];
    indexes.push(index);
    sourceIndexesByEntry.set(item.entry.id, indexes);
  });
  const exactEntry = (entryId: string) =>
    (sourceIndexesByEntry.get(entryId) ?? []).every((index) => matches.has(index));
  const eligibleEntries = new Set<string>();
  for (const assistantEntryId of selectedAssistants) {
    const group = groups.get(assistantEntryId) ?? new Set([assistantEntryId]);
    if ([...group].every(exactEntry)) for (const entryId of group) eligibleEntries.add(entryId);
  }
  // A result is removable only through its exact call/result group.
  for (const resultEntryId of selectedResults) {
    if (!assistantByResultEntry.has(resultEntryId)) eligibleEntries.delete(resultEntryId);
  }

  let removedAssistantBlocks = 0;
  let removedToolResults = 0;
  const messages = incoming.flatMap((message, incomingIndex) => {
    const sourceIndex = incomingToSource.get(incomingIndex);
    if (sourceIndex === undefined) return [message];
    const sourceMessage = source[sourceIndex];
    if (!sourceMessage) return [message];
    const entryId = sourceMessage.entry.id;
    if (selectedResults.has(entryId) && eligibleEntries.has(entryId)) {
      removedToolResults++;
      return [];
    }
    if (message.role !== "assistant" || !selectedAssistants.has(entryId) || !eligibleEntries.has(entryId))
      return [message];
    const content = message.content.filter((part) => {
      const remove = isRecord(part) && (part.type === "thinking" || part.type === "toolCall");
      if (remove) removedAssistantBlocks++;
      return !remove;
    });
    return content.length ? [{ ...message, content } as AgentMessage] : [];
  });
  return { messages, removedAssistantBlocks, removedToolResults };
}

/** Project the actual incoming transformed messages. Ambiguous protocol batches
 * are retained whole rather than risking an orphan call/result. */
export function projectShakenContext(
  incoming: readonly AgentMessage[],
  entries: readonly SessionEntry[],
  record: ShakeRecord,
): AgentMessage[] {
  return projection(incoming, entries, record).messages;
}
export function estimateContext(messages: readonly AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message), 0);
}
function hasOpaqueNativeCheckpoint(entries: readonly SessionEntry[]): boolean {
  return entries.some(
    (entry) => entry.type === "compaction" && isRecord(entry.details) && entry.details.strategy === "codex-native",
  );
}

async function currentTransformedContext(
  ctx: ExtensionContext,
  entries: readonly SessionEntry[],
): Promise<AgentMessage[]> {
  const raw = entries.flatMap(sessionEntryToContextMessages);
  const session = getInstructionContinuitySession(ctx.sessionManager as object);
  const agent = session?.agent;
  const transform = agent?.transformContext;
  if (typeof transform === "function") {
    const getSignal = (ctx as ExtensionContext & { getSignal?: () => AbortSignal }).getSignal;
    const signal = typeof getSignal === "function" ? getSignal.call(ctx) : new AbortController().signal;
    return await transform.call(agent, structuredClone(raw), signal);
  }
  const prior = latestShakeRecord(entries, ctx.sessionManager.getSessionId());
  return prior ? projectShakenContext(raw, entries, prior) : raw;
}

let accountingAdapterInstalled = false;
/** Pi's pre-prompt check normally trusts the last provider usage. A shake makes
 * that usage stale; skip it until a post-marker response exists. The separate
 * pre-provider estimator still sees the transformed/projected message list. */
export function installShakeAccountingAdapter(): void {
  if (accountingAdapterInstalled) return;
  const prototype = AgentSession.prototype as unknown as {
    _checkCompaction?: (message: AgentMessage, skipAbortedCheck?: boolean) => Promise<boolean>;
    getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
    sessionManager?: { buildContextEntries(): SessionEntry[]; getBranch(): SessionEntry[]; getSessionId(): string };
  };
  const originalCheck = prototype._checkCompaction;
  const originalUsage = prototype.getContextUsage;
  if (typeof originalCheck !== "function" || typeof originalUsage !== "function")
    throw new Error(
      "die manual shake is unsupported by this Pi runtime: required AgentSession accounting seams are unavailable",
    );
  const lacksFreshUsage = (owner: typeof prototype): boolean => {
    const manager = owner.sessionManager;
    if (!manager) return false;
    const branch = manager.buildContextEntries();
    let marker = -1;
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (entry?.type !== "custom" || entry.customType !== MANUAL_SHAKE_ENTRY) continue;
      if (!isShakeRecord(entry.data)) throw new InvalidShakeRecordError();
      marker = index;
      break;
    }
    if (marker < 0) return false;
    return !branch
      .slice(marker + 1)
      .some(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "assistant" &&
          entry.message.stopReason !== "error" &&
          entry.message.stopReason !== "aborted" &&
          entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite > 0,
      );
  };
  accountingAdapterInstalled = true;
  prototype._checkCompaction = async function (message, skipAbortedCheck) {
    if (lacksFreshUsage(this)) return false;
    return await originalCheck.call(this, message, skipAbortedCheck);
  };
  prototype.getContextUsage = function () {
    const usage = originalUsage.call(this);
    return usage && lacksFreshUsage(this) ? { ...usage, tokens: null, percent: null } : usage;
  };
}

export function registerManualShake(pi: ExtensionAPI, invalidateProviderSnapshot: () => void = () => {}): void {
  installShakeAccountingAdapter();
  pi.on("context", (event, ctx) => {
    const entries = ctx.sessionManager.buildContextEntries();
    const record = latestShakeRecord(entries, ctx.sessionManager.getSessionId());
    return record ? { messages: projectShakenContext(event.messages, entries, record) } : undefined;
  });
  // Compaction may hide the old marker while retaining some of its tail. Carry
  // only still-active IDs; an empty projection needs no marker after the summary.
  pi.on("session_compact", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const prior = latestShakeRecord(ctx.sessionManager.getBranch(), sessionId);
    if (!prior) return;
    const activeEntries = ctx.sessionManager.buildContextEntries();
    const active = new Set(activeEntries.map((entry) => entry.id));
    const record: ShakeRecord = {
      ...prior,
      sessionId,
      assistantEntryIds: prior.assistantEntryIds.filter((id) => active.has(id)),
      toolResultEntryIds: prior.toolResultEntryIds.filter((id) => active.has(id)),
      shakenAt: Date.now(),
    };
    if (record.assistantEntryIds.length || record.toolResultEntryIds.length) pi.appendEntry(MANUAL_SHAKE_ENTRY, record);
  });
  pi.registerCommand("shake", {
    description: "Prune completed execution traces from active model context",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Usage: /shake", "error");
        return;
      }
      if (!ctx.isIdle() || ctx.hasPendingMessages()) {
        ctx.ui.notify("Shake refused: wait until the active turn and queued message batch are settled.", "warning");
        return;
      }
      const entries = ctx.sessionManager.buildContextEntries();
      if (hasOpaqueNativeCheckpoint(entries)) {
        ctx.ui.notify(
          "Shake refused: this branch contains opaque native Codex checkpoint state. Branch before the checkpoint or continue without shaking; die will not flatten or relabel it.",
          "error",
        );
        return;
      }
      let plan: ShakePlan;
      let beforeMessages: AgentMessage[];
      try {
        const sessionId = ctx.sessionManager.getSessionId();
        plan = buildShakePlan(entries, sessionId);
        beforeMessages = await currentTransformedContext(ctx, entries);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }
      if (plan.storageError) {
        ctx.ui.notify(plan.storageError, "error");
        return;
      }
      if (plan.unresolvedToolCallIds.length || plan.orphanToolResultIds.length) {
        ctx.ui.notify(
          "Shake refused: the active branch has an unresolved or ambiguous tool batch; no context was changed.",
          "warning",
        );
        return;
      }
      const projected = projection(beforeMessages, entries, plan.record);
      if (!projected.removedAssistantBlocks && !projected.removedToolResults) {
        ctx.ui.notify(
          "Shake made no changes: active transformed context has no unambiguous newly eligible completed execution trace.",
          "info",
        );
        return;
      }
      const before = estimateContext(beforeMessages);
      const after = estimateContext(projected.messages);
      pi.appendEntry(MANUAL_SHAKE_ENTRY, plan.record);
      invalidateProviderSnapshot();
      ctx.ui.notify(
        "Shake complete (local estimates, no provider request): ~" +
          before +
          " → ~" +
          after +
          " active-context tokens; removed " +
          projected.removedAssistantBlocks +
          " assistant thinking/tool block(s) and " +
          projected.removedToolResults +
          " tool result message(s). Original transcript and usage/cost entries remain intact in append-only JSONL history. Removing an old prefix may invalidate provider prompt caches; no cost savings are guaranteed.",
        "info",
      );
    },
  });
}
