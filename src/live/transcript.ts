/** GPT-Live supplies timestamped provisional deltas, not ASR turn completion.
 * Group only adjacent fragments; speaker switches, time gaps, duration, size and
 * idle time bound an entry. This is presentation/history only, never handoff input.
 */
export class LiveFragmentGroups {
  private pending?: {
    speaker: "You" | "Voice";
    text: string;
    start: number;
    end: number;
    status: "partial" | "suppressed";
  };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly save: (speaker: "You" | "Voice", text: string, status: "partial" | "suppressed") => void,
    private readonly idleMs = 750,
  ) {}
  receive(
    speaker: "You" | "Voice",
    fragment: { delta: string; startMs: number; endMs: number },
    suppressed = false,
  ): void {
    if (!fragment.delta) return;
    const status = speaker === "Voice" && suppressed ? "suppressed" : "partial";
    const prior = this.pending;
    if (
      prior &&
      (prior.speaker !== speaker ||
        prior.status !== status ||
        fragment.startMs < prior.start ||
        fragment.startMs - prior.end > 600 ||
        fragment.endMs - prior.start > 2500 ||
        prior.text.length + fragment.delta.length > 4096)
    )
      this.flush();
    if (!this.pending) this.pending = { speaker, text: "", start: fragment.startMs, end: fragment.endMs, status };
    this.pending.text += fragment.delta;
    this.pending.end = Math.max(this.pending.end, fragment.endMs);
    // Timer flushes the last fragment even when no further provider event arrives.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.idleMs);
    this.timer.unref?.();
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const entry = this.pending;
    this.pending = undefined;
    if (entry?.text) this.save(entry.speaker, entry.text, entry.status);
  }
}
