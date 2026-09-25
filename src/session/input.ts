export const inputHandoffReasons = {
  transcript_unavailable: "Handoff requires an eligible completed captured user transcript. This request was not sent.",
  request_already_used: "Handoff request ID was already attempted and cannot select another transcript.",
  request_limit: "Handoff request limit reached for this input session. No transcript was sent.",
} as const;

/** Single-use authority from completed input, independent of provider/tool call IDs.
 * Presentation transcripts and model turn boundaries must never grant authority.
 */
export class InputHandoffError extends Error {
  constructor(readonly code: "transcript_unavailable" | "request_already_used" | "request_limit") {
    super(inputHandoffReasons[code]);
  }
}

export class CompletedInput {
  private pending?: { text: string; expiresAt: number };
  private readonly attempted = new Set<string>();
  constructor(private readonly now: () => number = () => performance.now()) {}

  capture(value: string): void {
    const text = value.trim();
    this.pending = text && value.length <= 4000 ? { text, expiresAt: this.now() + 60_000 } : undefined;
  }
  revoke(): void {
    this.pending = undefined;
  }
  /** Tombstone before argument validation; rejected requests cannot acquire newer input. */
  attempt(requestId: string): void {
    if (this.attempted.has(requestId)) throw new InputHandoffError("request_already_used");
    if (this.attempted.size >= 256) throw new InputHandoffError("request_limit");
    this.attempted.add(requestId);
  }
  /** Consume before dispatch, including ambiguous host failures. */
  consume(): string {
    if (this.pending && this.now() >= this.pending.expiresAt) this.pending = undefined;
    if (!this.pending) throw new InputHandoffError("transcript_unavailable");
    const text = this.pending.text;
    this.pending = undefined;
    return text;
  }
}
