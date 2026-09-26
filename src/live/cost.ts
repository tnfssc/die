/** Voice billing is separate from Pi/agent usage. Only provider usage events move totals. */
export const VOICE_COST_ENTRY = "die-live-cost";
const number = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const tokenCount = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const record = (v: unknown): Record<string, any> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : undefined;

export function voiceCost(provider: "google" | "openai", model: string, usage: unknown): number | undefined {
  const u = record(usage);
  if (!u) return;
  if (model === "gpt-live-1") {
    const seconds = number(u.seconds);
    return seconds === undefined ? undefined : (seconds * 0.05) / 60;
  }
  if (model === "gemini-3.8-live" || model === "gemini-3.8-live-extended-thinking") {
    // Live usageMetadata is per model turn; require modality detail rather than
    // treating all input as audio or all output as text.
    const price = (parts: unknown, rates: Record<string, number>): number | undefined => {
      if (!Array.isArray(parts)) return;
      let sum = 0;
      for (const part of parts) {
        const modality = part?.modality?.toUpperCase?.();
        const count = tokenCount(part?.tokenCount);
        if (count === undefined || rates[modality] === undefined) return;
        sum += (count * rates[modality]) / 1e6;
      }
      return sum;
    };
    // SDK usageMetadata may call cached modality detail cachedTokensDetails or
    // cacheTokensDetails. Neither gives a verified cached rate for this model.
    // Do not count cached tokens as full-rate prompt tokens.
    const cached = [u.cachedContentTokenCount, u.cachedTokensDetails, u.cacheTokensDetails];
    if (cached[0] !== undefined && tokenCount(cached[0]) === undefined) return;
    for (const details of cached.slice(1)) {
      if (
        details !== undefined &&
        (!Array.isArray(details) ||
          details.some((part) => {
            const modality = part?.modality;
            return typeof modality !== "string" || tokenCount(part?.tokenCount) === undefined;
          }))
      )
        return;
    }
    if (
      cached[0] > 0 ||
      cached.slice(1).some((details) => details?.some((part: { tokenCount: number }) => part.tokenCount > 0))
    )
      return;
    for (const key of ["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount"]) {
      if (u[key] !== undefined && tokenCount(u[key]) === undefined) return;
    }
    const input = price(u.promptTokensDetails, { TEXT: 0.75, AUDIO: 3, IMAGE: 1, VIDEO: 1 });
    const output = price(u.candidatesTokensDetails, { TEXT: 4.5, AUDIO: 12 });
    // Thinking tokens are included in output price; without their modality we
    // cannot safely assign the correct rate. No fabricated zero for omitted detail.
    if (input === undefined || output === undefined || u.thoughtsTokenCount > 0) return;
    return input + output;
  }
  const rates: Record<string, [number, number, number, number]> = {
    "gpt-realtime-2.1": [32, 64, 4, 24],
    "gpt-realtime-2.1-mini": [10, 20, 0.6, 2.4],
  };
  const rate = rates[model];
  if (!rate) return;
  const input = number(u.input_tokens),
    output = number(u.output_tokens);
  const audioIn = number(u.input_token_details?.audio_tokens),
    audioOut = number(u.output_token_details?.audio_tokens);
  if (
    input === undefined ||
    output === undefined ||
    audioIn === undefined ||
    audioOut === undefined ||
    audioIn > input ||
    audioOut > output
  )
    return;
  // Cached input needs separate modality details/rate; don't silently price it at full rate.
  if (number(u.input_token_details?.cached_tokens) && u.input_token_details.cached_tokens > 0) return;
  return (audioIn * rate[0] + audioOut * rate[1] + (input - audioIn) * rate[2] + (output - audioOut) * rate[3]) / 1e6;
}

/** One tracker per transport. GPT-Live updates are cumulative; other events are
 * per response/turn. Persist only increments, never cumulative totals. */
export class VoiceCostTracker {
  private previous = 0;
  private turnPrevious = 0;
  private readonly seen = new Set<string>();
  private unknown = false;
  private markUnknown() {
    if (this.unknown) return;
    this.unknown = true;
    this.persist({ cost: 0, unknown: true });
  }
  private closed = false;
  private received = false;
  constructor(
    private readonly provider: "google" | "openai",
    private readonly model: string,
    private readonly persist: (entry: { cost: number; unknown?: boolean }) => void,
  ) {}
  get incomplete() {
    return this.unknown || !this.received || this.model === "gpt-live-1" || this.provider === "openai";
  }
  usage(value: unknown, id?: string) {
    if (id && this.seen.has(id)) return;
    if (id) this.seen.add(id);
    this.received = true;
    const cost = voiceCost(this.provider, this.model, value);
    if (cost === undefined) {
      this.markUnknown();
      return;
    }
    this.persist({ cost });
  }
  gemini(value: unknown) {
    this.received = true;
    const cost = voiceCost(this.provider, this.model, value);
    if (cost === undefined) {
      this.markUnknown();
      return;
    }
    if (cost > this.turnPrevious) this.persist({ cost: cost - this.turnPrevious });
    this.turnPrevious = Math.max(this.turnPrevious, cost);
  }
  turnComplete() {
    this.turnPrevious = 0;
  }
  cumulative(value: unknown) {
    this.received = true;
    const cost = voiceCost(this.provider, this.model, value);
    if (cost === undefined) {
      this.markUnknown();
      return;
    }
    if (cost > this.previous) this.persist({ cost: cost - this.previous });
    this.previous = Math.max(this.previous, cost);
  }
  close(finalized = true) {
    if (this.closed) return;
    this.closed = true;
    if (!finalized || this.incomplete) this.markUnknown();
  }
}
