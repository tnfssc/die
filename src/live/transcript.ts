import type { VoiceTranscript } from "./types";
export const VOICE_ENTRY = "die-live-transcript";
export type TranscriptEntry = { speaker: "You" | "Voice"; text: string; status: "final" | "turn-boundary" | "interrupted" | "partial" };
/** Received text is not audio or evidence that generated speech was heard. */
export class TranscriptLog {
  private pending: Record<"You" | "Voice", string> = { You: "", Voice: "" };
  private recent: TranscriptEntry[] = [];
  private omitted = 0;
  constructor(private readonly save: (entry: TranscriptEntry) => void) {}
  receive(speaker: "You" | "Voice", part: VoiceTranscript): void {
    if (speaker === "You" && part.finalitySource === "model_contract") this.finish("You", "partial");
    this.pending[speaker] += part.text;
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
      this.recent.shift(); this.omitted++;
    }
  }
  reset(): void { this.pending = { You: "", Voice: "" }; this.recent = []; this.omitted = 0; }
  /** Widget is a viewport: shortened lines and omitted entries are always labeled. */
  view(clean: (text: string) => string): string[] {
    const render = (e: TranscriptEntry) => {
      const text = clean(e.text);
      return e.speaker + " [" + e.status + (e.speaker === "Voice" ? ", hearing unverified" : "") + "]: " +
        (text.length > 700 ? text.slice(0, 700) + "… [" + (text.length - 700) + " chars not shown here]" : text);
    };
    const entries = this.recent.slice(-4);
    const hidden = this.omitted + this.recent.length - entries.length;
    return [ ...(hidden ? ["[" + hidden + " earlier transcript entries not shown; session history retains received text]"] : []),
      ...entries.map(render), ...(["You", "Voice"] as const).filter(s => this.pending[s]).map(s => render({ speaker: s, text: this.pending[s], status: "partial" })) ];
  }
}
