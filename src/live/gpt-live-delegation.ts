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
  target?: string;
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
}
export interface ContextualDelegationHost {
  context(): unknown;
  /** MUST use the existing current-session agent, permission prompts, and authorization scope.
   * The structured snapshot is provisional evidence for that agent to interpret; do not
   * label it as final user speech. Ambiguous/irreversible actions require clarification.
   * Returns only verified dispatch status, never untrusted job output or agent reasoning.
   */
  submitContextual(requestId: string, snapshot: DelegationSnapshot): Promise<{ queued: true } | { clarification: true }>;
}
export type DelegationResult =
  | { kind: "queued" | "clarification"; id: string; revision: number; commentary: string }
  | { kind: "stale" | "duplicate" | "unavailable"; id: string };

function boundedData(value: unknown, max = 3800): string {
  let serialized: string;
  try { serialized = JSON.stringify(value) ?? "null"; } catch { serialized = '"unavailable"'; }
  return serialized.length <= max ? serialized : JSON.stringify({ truncated: true, preview: serialized.slice(0, 1600) });
}
/** One instance per Live connection. Closing invalidates results but never cancels backend work. */
export class GptLiveDelegationBridge {
  private fragments: LiveFragment[] = [];
  private omitted = 0;
  private revision = 0;
  private epoch = 0;
  private closed = false;
  private readonly attempted = new Set<string>();
  constructor(private readonly host: ContextualDelegationHost) {}

  addFragment(fragment: LiveFragment): void {
    if (this.closed || !Number.isFinite(fragment.startMs) || !Number.isFinite(fragment.endMs) ||
      fragment.startMs < 0 || fragment.endMs < fragment.startMs || typeof fragment.text !== "string" ||
      !fragment.text.trim() || fragment.text.length > 1000) return;
    // Corrections can arrive late. Keep order of arrival and retain timeline coordinates.
    this.fragments.push({ ...fragment });
    this.revision++;
    while (this.fragments.length > 32 || JSON.stringify(this.fragments).length > 6000) {
      this.fragments.shift();
      this.omitted++;
    }
  }

  /** Barge-in only invalidates spoken results. It does not stop the host agent or its jobs. */
  interrupt(): void { this.epoch++; }
  close(): void { this.closed = true; this.epoch++; }

  async handleCreated(event: LiveDelegation): Promise<DelegationResult> {
    if (typeof event.id !== "string" || !event.id.trim() || event.id.length > 128 ||
      !Number.isFinite(event.offsetMs) || event.offsetMs < 0 || !Number.isSafeInteger(event.offsetMs))
      return { kind: "unavailable", id: "invalid" };
    const id = event.id;
    if (this.attempted.has(id)) return { kind: "duplicate", id };
    // Never evict IDs in a session: a replay must not acquire a different snapshot.
    if (this.closed || this.attempted.size >= 256) return { kind: "unavailable", id };
    this.attempted.add(id); // before any async operation, including rejected requests
    const epoch = this.epoch;
    const revision = this.revision;
    const snapshot: DelegationSnapshot = {
      delegationId: id,
      offsetMs: event.offsetMs,
      revision,
      fragments: this.fragments.filter((fragment) => fragment.endMs <= event.offsetMs).map((f) => ({ ...f })),
      omittedFragments: this.omitted,
      uncertain: true,
      hostContext: boundedData((() => { try { return this.host.context(); } catch { return { unavailable: true }; } })()),
    };
    try {
      // No synthetic tool names, task text, cancellation, or exact speech check.
      const result = await this.host.submitContextual(id, snapshot);
      if (this.closed || this.epoch !== epoch || this.revision !== revision)
        return { kind: "stale", id };
      if (result && "queued" in result && result.queued === true)
        return { kind: "queued", id, revision, commentary: "Passed your request to the current agent." };
      if (result && "clarification" in result && result.clarification === true)
        return { kind: "clarification", id, revision, commentary: "Could you clarify your request?" };
      return { kind: "unavailable", id };
    } catch {
      // Do not expose raw errors or untrusted backend output as speech.
      return { kind: "unavailable", id };
    }
  }
}
