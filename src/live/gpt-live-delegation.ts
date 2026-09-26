/** GPT-Live client delegation. This is deliberately not the Realtime exact-transcript tool bridge. */
export interface LiveFragment {
  /** Milliseconds on the Live session timeline, not arrival time. */
  startMs: number;
  endMs: number;
  text: string;
}
export interface LiveDelegation {
  id: string;
  offsetMs: number;
  target: "client";
}
export interface DelegationSnapshot {
  delegationId: string;
  offsetMs: number;
  revision: number;
  /** Not final ASR, and not an authoritative command. */
  fragments: readonly LiveFragment[];
  omittedFragments: number;
  /** Timing watermark only, not an ASR finalization/replacement rule. */
  priorSpeechEndMs?: number;
  uncertain: true;
  /** Data-only, bounded serialization of the current configured agent's context. */
  hostContext: string;
  /** Local continuous-capture clock: approximate alignment, never server-verified. */
  hostContextOffsetMs: number;
  contextClock: "local-capture-approximate";
}
export interface ContextualDelegationHost {
  context(): unknown;
  /** MUST use the existing current-session agent, permission prompts, and authorization scope.
   * The structured snapshot is provisional evidence for that agent to interpret; do not
   * label it as final user speech. Ambiguous/irreversible actions require clarification.
   * Returns only verified dispatch status, never untrusted job output or agent reasoning.
   */
  submitContextual(
    requestId: string,
    snapshot: DelegationSnapshot,
  ): Promise<{ queued: true } | { clarification: true }>;
}
export type DelegationResult =
  | { kind: "queued" | "clarification"; id: string; revision: number; commentary: string }
  | { kind: "stale" | "duplicate" | "unavailable"; id: string };

function boundedData(value: unknown, max = 3800): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    serialized = '"unavailable"';
  }
  return serialized.length <= max
    ? serialized
    : JSON.stringify({ truncated: true, preview: serialized.slice(0, 1600) });
}
// Bound retained serialized UTF-8 evidence, not tiny provider delta count.
export const GPT_LIVE_FRAGMENT_BYTES = 64 * 1024;
const fragmentBytes = (fragment: LiveFragment) => Buffer.byteLength(JSON.stringify(fragment), "utf8") + 1;

/** One instance per Live connection. Closing invalidates results but never cancels backend work. */
export class GptLiveDelegationBridge {
  private fragments: LiveFragment[] = [];
  private retainedBytes = 2;
  private omitted = 0;
  private omittedThroughMs = -1;
  private readonly consumedFragments = new WeakSet<LiveFragment>();
  private readonly pendingFragments = new WeakSet<LiveFragment>();
  private readonly pendingEvicted = new Set<LiveFragment>();
  private consumedOmitted = 0;
  private revision = 0;
  private admittedThroughMs = -1;
  private epoch = 0;
  private closed = false;
  private readonly attempted = new Set<string>();
  private contexts: { offsetMs: number; data: string }[] = [];
  constructor(private readonly host: ContextualDelegationHost) {
    this.saveContext(0);
  }

  /** Save context when observed, not later when an old delegation finally arrives. */
  saveContext(offsetMs: number): void {
    if (this.closed || !Number.isSafeInteger(offsetMs) || offsetMs < 0) return;
    let data: string;
    try {
      data = boundedData(this.host.context());
    } catch {
      return;
    }
    const last = this.contexts.at(-1);
    if (last && (last.data === data || offsetMs < last.offsetMs)) return;
    if (last) this.revision++;
    this.contexts.push({ offsetMs, data });
    if (this.contexts.length > 16) this.contexts.shift();
  }

  addFragment(fragment: LiveFragment): void {
    if (
      this.closed ||
      !Number.isFinite(fragment.startMs) ||
      !Number.isFinite(fragment.endMs) ||
      fragment.startMs < 0 ||
      fragment.endMs < fragment.startMs ||
      typeof fragment.text !== "string" ||
      !fragment.text.length
    )
      return;
    // Corrections can arrive late. Keep order of arrival and retain timeline coordinates.
    const retained = { ...fragment };
    this.fragments.push(retained);
    this.retainedBytes += fragmentBytes(retained);
    this.revision++;
    while (this.retainedBytes > GPT_LIVE_FRAGMENT_BYTES) {
      const removed = this.fragments.shift()!;
      this.retainedBytes -= fragmentBytes(removed);
      if (this.pendingFragments.has(removed)) this.pendingEvicted.add(removed);
      else if (!this.consumedFragments.has(removed)) this.recordOmission(removed);
    }
  }

  private recordOmission(fragment: LiveFragment): void {
    this.omitted++;
    this.omittedThroughMs = Math.max(this.omittedThroughMs, fragment.endMs);
  }

  /** Barge-in only invalidates spoken results. It does not stop the host agent or its jobs. */
  interrupt(): void {
    this.epoch++;
  }
  close(): void {
    this.closed = true;
    this.epoch++;
  }

  async handleCreated(event: LiveDelegation): Promise<DelegationResult> {
    if (
      typeof event.id !== "string" ||
      !event.id.trim() ||
      event.id.length > 256 ||
      event.target !== "client" ||
      !Number.isFinite(event.offsetMs) ||
      event.offsetMs < 0 ||
      !Number.isSafeInteger(event.offsetMs)
    )
      return { kind: "unavailable", id: "invalid" };
    const id = event.id;
    if (this.attempted.has(id)) return { kind: "duplicate", id };
    // Never evict IDs in a session: a replay must not acquire a different snapshot.
    if (this.closed || this.attempted.size >= 256) return { kind: "unavailable", id };
    this.attempted.add(id); // before any async operation, including rejected requests
    const epoch = this.epoch;
    const revision = this.revision;
    const context = [...this.contexts].reverse().find((entry) => entry.offsetMs <= event.offsetMs);
    if (!context) return { kind: "unavailable", id };
    // Admission still decides whether evicted pending speech is missing. Do not
    // dispatch a suffix while that decision is unresolved.
    if (this.pendingEvicted.size)
      return {
        kind: "clarification",
        id,
        revision,
        commentary: "I'm still checking whether the earlier request was accepted. Please try again in a moment.",
      };
    const omittedAtCapture = this.omitted;
    const selected = this.fragments.filter(
      (fragment) =>
        !this.consumedFragments.has(fragment) &&
        !this.pendingFragments.has(fragment) &&
        fragment.endMs <= event.offsetMs,
    );
    const snapshot: DelegationSnapshot = {
      delegationId: id,
      offsetMs: event.offsetMs,
      revision,
      ...(this.admittedThroughMs >= 0 ? { priorSpeechEndMs: this.admittedThroughMs } : {}),
      fragments: selected.map((f) => ({ ...f })),
      omittedFragments: Math.max(0, omittedAtCapture - this.consumedOmitted),
      uncertain: true,
      hostContext: context.data,
      hostContextOffsetMs: context.offsetMs,
      contextClock: "local-capture-approximate",
    };
    if (snapshot.omittedFragments > 0) {
      // An old delegation cannot acknowledge newer loss and unlock its suffix.
      if (
        event.offsetMs < this.omittedThroughMs ||
        this.fragments.some((fragment) => !this.consumedFragments.has(fragment) && fragment.endMs > event.offsetMs)
      )
        return { kind: "unavailable", id };
      // Never execute an unsafe suffix. Retire this incomplete attempt so a
      // fresh repeat can recover; it was NOT admitted to the coding agent.
      for (const fragment of selected) this.consumedFragments.add(fragment);
      this.consumedOmitted = omittedAtCapture;
      this.omittedThroughMs = -1;
      return {
        kind: "clarification",
        id,
        revision,
        commentary: "I couldn't retain the whole request. Please repeat it.",
      };
    }
    for (const fragment of selected) this.pendingFragments.add(fragment);
    try {
      // No synthetic tool names, task text, cancellation, or exact speech check.
      const result = await this.host.submitContextual(id, snapshot);
      if (result && "queued" in result && result.queued === true) {
        for (const fragment of selected) {
          this.consumedFragments.add(fragment);
          this.admittedThroughMs = Math.max(this.admittedThroughMs, fragment.endMs);
        }
        this.consumedOmitted = Math.max(this.consumedOmitted, omittedAtCapture);
      }
      if (this.closed || this.epoch !== epoch || this.revision !== revision) return { kind: "stale", id };
      if (result && "queued" in result && result.queued === true)
        return { kind: "queued", id, revision, commentary: "Passed your request to the current agent." };
      if (result && "clarification" in result && result.clarification === true)
        return { kind: "clarification", id, revision, commentary: "Could you clarify your request?" };
      return { kind: "unavailable", id };
    } catch {
      // Rejection is just as stale as success after correction/interruption/closure.
      if (this.closed || this.epoch !== epoch || this.revision !== revision) return { kind: "stale", id };
      // Do not expose raw errors or untrusted backend output as speech.
      return { kind: "unavailable", id };
    } finally {
      for (const fragment of selected) {
        this.pendingFragments.delete(fragment);
        // Evicted pending evidence is lost only if admission failed; an admitted
        // request already carries it in ordinary agent history.
        if (this.pendingEvicted.has(fragment) && !this.consumedFragments.has(fragment)) this.recordOmission(fragment);
        this.pendingEvicted.delete(fragment);
      }
    }
  }
}
