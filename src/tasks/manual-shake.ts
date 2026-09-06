import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  AgentSession,
  estimateTokens,
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

/** Durable, branch-scoped manual context projection. Session JSONL stays append-only. */
export const MANUAL_SHAKE_ENTRY = "die-manual-shake";
export const MANUAL_SHAKE_VERSION = 1;

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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function isShakeRecord(value: unknown): value is ShakeRecord {
  return (
    isRecord(value) &&
    value.version === MANUAL_SHAKE_VERSION &&
    typeof value.sessionId === "string" &&
    typeof value.shakenAt === "number" &&
    Array.isArray(value.assistantEntryIds) &&
    value.assistantEntryIds.every((id) => typeof id === "string") &&
    Array.isArray(value.toolResultEntryIds) &&
    value.toolResultEntryIds.every((id) => typeof id === "string")
  );
}
export function latestShakeRecord(entries: readonly SessionEntry[], _sessionId: string): ShakeRecord | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.type === "custom" && entry.customType === MANUAL_SHAKE_ENTRY && isShakeRecord(entry.data))
      return entry.data;
  }
}
function toolCalls(message: AgentMessage): Array<{ id: string }> {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.flatMap((part) =>
    isRecord(part) && part.type === "toolCall" && typeof part.id === "string" ? [{ id: part.id }] : [],
  );
}
function toolResultId(message: AgentMessage): string | undefined {
  if (message.role !== "toolResult") return;
  const id = (message as AgentMessage & { toolCallId?: unknown }).toolCallId;
  return typeof id === "string" ? id : undefined;
}
function removableAssistantBlockCount(message: AgentMessage): number {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return 0;
  return message.content.filter((part) => isRecord(part) && (part.type === "thinking" || part.type === "toolCall"))
    .length;
}

/** Build a deterministic protocol-paired plan from the active branch. */
export function buildShakePlan(
  entries: readonly SessionEntry[],
  sessionId: string,
  prior = latestShakeRecord(entries, sessionId),
): ShakePlan {
  const calls = new Map<string, string>();
  const results = new Map<string, string>();
  const duplicateCalls = new Set<string>();
  const duplicateResults = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    for (const call of toolCalls(entry.message)) {
      if (calls.has(call.id)) duplicateCalls.add(call.id);
      else calls.set(call.id, entry.id);
    }
    const resultId = toolResultId(entry.message);
    if (resultId) {
      if (results.has(resultId)) duplicateResults.add(resultId);
      else results.set(resultId, entry.id);
    }
  }
  const unresolvedToolCallIds = [...calls.keys()].filter((id) => !results.has(id));
  const orphanToolResultIds = [...results.keys()].filter((id) => !calls.has(id));
  unresolvedToolCallIds.push(...duplicateCalls);
  orphanToolResultIds.push(...duplicateResults);
  const assistantIds = new Set(prior?.assistantEntryIds ?? []);
  const resultIds = new Set(prior?.toolResultEntryIds ?? []);
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
  return {
    record: {
      version: MANUAL_SHAKE_VERSION,
      sessionId,
      assistantEntryIds: [...assistantIds],
      toolResultEntryIds: [...resultIds],
      shakenAt: Date.now(),
    },
    removedAssistantBlocks,
    removedToolResults,
    unresolvedToolCallIds: [...new Set(unresolvedToolCallIds)],
    orphanToolResultIds: [...new Set(orphanToolResultIds)],
  };
}
function projectMessage(message: AgentMessage, entry: SessionEntry, record: ShakeRecord): AgentMessage[] {
  if (record.toolResultEntryIds.includes(entry.id)) return [];
  if (message.role !== "assistant" || !record.assistantEntryIds.includes(entry.id) || !Array.isArray(message.content))
    return [message];
  const content = message.content.filter(
    (part) => !(isRecord(part) && (part.type === "thinking" || part.type === "toolCall")),
  );
  // Mixed text/tool turns retain their prose. stopReason=toolUse is not evidence
  // that adjacent text was merely an execution trace.
  return content.length ? [{ ...message, content } as AgentMessage] : [];
}

/** Preserve prior context exclusions: project only incoming messages, matching duplicate values chronologically. */
export function projectShakenContext(
  incoming: readonly AgentMessage[],
  entries: readonly SessionEntry[],
  record: ShakeRecord,
): AgentMessage[] {
  const source = entries.flatMap((entry) =>
    sessionEntryToContextMessages(entry).map((message) => ({ entry, json: JSON.stringify(message) })),
  );
  let cursor = 0;
  return incoming.flatMap((message) => {
    const json = JSON.stringify(message);
    let match = -1;
    for (let index = cursor; index < source.length; index++)
      if (source[index]!.json === json) {
        match = index;
        break;
      }
    if (match < 0) return [message]; // extension-added/transformed content; never restore raw content
    cursor = match + 1;
    return projectMessage(message, source[match]!.entry, record);
  });
}
export function estimateContext(messages: readonly AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message), 0);
}
function hasOpaqueNativeCheckpoint(entries: readonly SessionEntry[]): boolean {
  return entries.some(
    (entry) => entry.type === "compaction" && isRecord(entry.details) && entry.details.strategy === "codex-native",
  );
}

let usageAdapterInstalled = false;
/** Pinned private seam: old provider usage must become unknown after a shake. */
export function installShakeUsageAdapter(): void {
  if (usageAdapterInstalled) return;
  const prototype = AgentSession.prototype as unknown as {
    getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
    sessionManager?: { getBranch(): SessionEntry[]; getSessionId(): string };
  };
  const original = prototype.getContextUsage;
  if (typeof original !== "function")
    throw new Error(
      "die manual shake is unsupported by this Pi runtime: required private AgentSession.getContextUsage seam is unavailable",
    );
  usageAdapterInstalled = true;
  prototype.getContextUsage = function () {
    const manager = this.sessionManager;
    if (manager) {
      const branch = manager.getBranch();
      let marker = -1;
      for (let index = branch.length - 1; index >= 0; index--) {
        const entry = branch[index]!;
        if (
          entry.type === "custom" &&
          entry.customType === MANUAL_SHAKE_ENTRY &&
          isShakeRecord(entry.data) &&
          entry.data.sessionId === manager.getSessionId()
        ) {
          marker = index;
          break;
        }
      }
      if (marker >= 0) {
        const fresh = branch
          .slice(marker + 1)
          .some(
            (entry) =>
              entry.type === "message" &&
              entry.message.role === "assistant" &&
              entry.message.stopReason !== "error" &&
              entry.message.stopReason !== "aborted" &&
              entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite > 0,
          );
        if (!fresh) {
          const prior = original.call(this);
          return prior ? { tokens: null, contextWindow: prior.contextWindow, percent: null } : undefined;
        }
      }
    }
    return original.call(this);
  };
}

export function registerManualShake(pi: ExtensionAPI, invalidateProviderSnapshot: () => void = () => {}): void {
  installShakeUsageAdapter();
  pi.on("context", (event, ctx) => {
    const entries = ctx.sessionManager.buildContextEntries();
    const record = latestShakeRecord(entries, ctx.sessionManager.getSessionId());
    return record ? { messages: projectShakenContext(event.messages, entries, record) } : undefined;
  });
  // A compaction may hide the old marker while retaining part of its tail.
  pi.on("session_compact", (_event, ctx) => {
    const record = latestShakeRecord(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId());
    if (record) pi.appendEntry(MANUAL_SHAKE_ENTRY, { ...record, shakenAt: Date.now() });
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
      const sessionId = ctx.sessionManager.getSessionId();
      const plan = buildShakePlan(entries, sessionId);
      if (plan.unresolvedToolCallIds.length || plan.orphanToolResultIds.length) {
        ctx.ui.notify(
          "Shake refused: the active branch has an unresolved or ambiguous tool batch; no context was changed.",
          "warning",
        );
        return;
      }
      if (!plan.removedAssistantBlocks && !plan.removedToolResults) {
        ctx.ui.notify("Shake made no changes: active context has no newly eligible completed execution trace.", "info");
        return;
      }
      const beforeMessages = entries.flatMap(sessionEntryToContextMessages);
      const afterMessages = projectShakenContext(beforeMessages, entries, plan.record);
      const before = estimateContext(beforeMessages),
        after = estimateContext(afterMessages);
      pi.appendEntry(MANUAL_SHAKE_ENTRY, plan.record);
      invalidateProviderSnapshot();
      ctx.ui.notify(
        "Shake complete (local estimates, no provider request): ~" +
          before +
          " → ~" +
          after +
          " active-context tokens; removed " +
          plan.removedAssistantBlocks +
          " assistant thinking/tool block(s) and " +
          plan.removedToolResults +
          " tool result message(s). Original transcript entries remain intact in append-only JSONL history. Removing an old prefix may invalidate provider prompt caches; no cost savings are guaranteed.",
        "info",
      );
    },
  });
}
