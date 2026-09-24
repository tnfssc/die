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
/** One instance per Live connection. Closing invalidates results but never cancels backend work. */
export class GptLiveDelegationBridge {
  private fragments: LiveFragment[] = [];
  private omitted = 0;
  private revision = 0;
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
      !fragment.text.trim() ||
      fragment.text.length > 4096
    )
      return;
    // Corrections can arrive late. Keep order of arrival and retain timeline coordinates.
    this.fragments.push({ ...fragment });
    this.revision++;
    while (this.fragments.length > 32 || JSON.stringify(this.fragments).length > 6000) {
      this.fragments.shift();
      this.omitted++;
    }
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
    const snapshot: DelegationSnapshot = {
      delegationId: id,
      offsetMs: event.offsetMs,
      revision,
      fragments: this.fragments.filter((fragment) => fragment.endMs <= event.offsetMs).map((f) => ({ ...f })),
      omittedFragments: this.omitted,
      uncertain: true,
      hostContext: context.data,
      hostContextOffsetMs: context.offsetMs,
      contextClock: "local-capture-approximate",
    };
    try {
      // No synthetic tool names, task text, cancellation, or exact speech check.
      const result = await this.host.submitContextual(id, snapshot);
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
    }
  }
}
