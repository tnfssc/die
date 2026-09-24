import type { VoiceTranscript } from "./types";
export const VOICE_ENTRY = "die-live-transcript";
export type TranscriptEntry = {
  speaker: "You" | "Voice";
  text: string;
  status: "final" | "turn-boundary" | "interrupted" | "partial" | "suppressed";
};
/** Received text is not audio or evidence that generated speech was heard. */
export class TranscriptLog {
  private pending: Record<"You" | "Voice", string> = { You: "", Voice: "" };
  private recent: TranscriptEntry[] = [];
  private omitted = 0;
  constructor(private readonly save: (entry: TranscriptEntry) => void) {}
  receive(speaker: "You" | "Voice", part: VoiceTranscript): void {
    if (speaker === "You" && part.finalitySource === "model_contract") this.finish("You", "partial");
    // Preserve received order when speakers interleave. A partial segment is
    // display/history data only; flushing it never authorizes a handoff.
    if (part.text) this.finish(speaker === "You" ? "Voice" : "You", "partial");
    // Persist bounded chunks rather than trimming or holding an endless utterance.
    let offset = 0;
    while (offset < part.text.length) {
      const take = Math.min(4096 - this.pending[speaker].length, part.text.length - offset);
      this.pending[speaker] += part.text.slice(offset, offset + take);
      offset += take;
      if (this.pending[speaker].length === 4096 && !(part.finished && offset === part.text.length))
        this.finish(speaker, "partial");
    }
    if (part.finished) this.finish(speaker, "final");
  }
  finish(speaker: "You" | "Voice", status: TranscriptEntry["status"]): void {
    const text = this.pending[speaker];
    this.pending[speaker] = "";
    if (!text) return;
    const entry = { speaker, text, status };
    this.save(entry);
    this.recent.push(entry);
    while (this.recent.length > 24 || this.recent.reduce((n, e) => n + e.text.length, 0) > 32768) {
      this.recent.shift();
      this.omitted++;
    }
  }
  reset(): void {
    this.pending = { You: "", Voice: "" };
    this.recent = [];
    this.omitted = 0;
  }
  /** Widget is a viewport: shortened lines and omitted entries are always labeled. */
  view(clean: (text: string) => string): string[] {
    const render = (e: TranscriptEntry) => {
      const text = clean(e.text);
      const label =
        e.speaker + (e.status === "suppressed" ? " (not played)" : e.status === "interrupted" ? " (interrupted)" : "");
      // Keep live text moving instead of freezing on the start of a long reply.
      // The complete received entry is kept separately in session history.
      return label + ": " + (text.length > 2400 ? "… [earlier text saved] " + text.slice(-2400) : text);
    };
    const entries = this.recent.slice(-4);
    const hidden = this.omitted + this.recent.length - entries.length;
    return [
      ...(hidden ? ["Earlier conversation saved in session history."] : []),
      ...entries.map(render),
      ...(["You", "Voice"] as const)
        .filter((s) => this.pending[s])
        .map((s) => render({ speaker: s, text: this.pending[s], status: "partial" })),
    ];
  }
}

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
