import { describe, expect, test } from "bun:test";
import { VoiceCostTracker, voiceCost } from "../src/live/cost";

describe("provider-reported CLI voice cost", () => {
  test("GPT-Live cumulative duration, duplicates, out-of-order, final correction; backend remains unknown", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("openai", "gpt-live-1", (e) => entries.push(e));
    tracker.cumulative({ seconds: 12 });
    tracker.cumulative({ seconds: 15 });
    tracker.cumulative({ seconds: 15 });
    tracker.cumulative({ seconds: 13 });
    tracker.cumulative({ seconds: 18 });
    tracker.close();
    expect(entries.map((e) => [Number(e.cost.toFixed(8)), e.unknown])).toEqual([
      [0.01, undefined],
      [0.0025, undefined],
      [0.0025, undefined],
      [0, true],
    ]);
  });
  test("Realtime charges text and audio separately and never charges a repeated response", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("openai", "gpt-realtime-2.1-mini", (e) => entries.push(e));
    const usage = {
      input_tokens: 300,
      output_tokens: 150,
      input_token_details: { audio_tokens: 200 },
      output_token_details: { audio_tokens: 100 },
    };
    tracker.usage(usage, "resp1");
    tracker.usage(usage, "resp1");
    expect(entries).toEqual([{ cost: (200 * 10 + 100 * 20 + 100 * 0.6 + 50 * 2.4) / 1e6 }]);
    expect(
      voiceCost("openai", "gpt-realtime-2.1", {
        ...usage,
        input_token_details: { audio_tokens: 200, cached_tokens: 50 },
      }),
    ).toBeUndefined();
    tracker.close();
    expect(entries.at(-1)?.unknown).toBe(true); // separate ASR usage unavailable
  });
  test("Gemini uses modality detail and per-turn cumulative snapshots with reset", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "gemini-3.8-live", (e) => entries.push(e));
    const usage = (n: number) => ({
      promptTokensDetails: [
        { modality: "AUDIO", tokenCount: n },
        { modality: "TEXT", tokenCount: 10 },
      ],
      candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 20 }],
    });
    tracker.gemini(usage(100));
    tracker.gemini(usage(100));
    tracker.gemini(usage(120));
    tracker.turnComplete();
    tracker.gemini(usage(100));
    tracker.close();
    expect(entries).toHaveLength(3);
    expect(entries.reduce((sum, e) => sum + e.cost, 0)).toBeCloseTo(
      ((100 + 120) * 3 + 20 * 12 * 2 + 10 * 0.75 * 2) / 1e6,
      10,
    );
    expect(voiceCost("google", "gemini-3.8-live", { promptTokenCount: 100, candidatesTokenCount: 20 })).toBeUndefined();
    expect(voiceCost("google", "gemini-3.8-live-extended-thinking", usage(100))).toBeCloseTo(voiceCost("google", "gemini-3.8-live", usage(100))!);
    expect(voiceCost("google", "gemini-3.8-live-extended-thinking", { ...usage(100), thoughtsTokenCount: 3 })).toBeUndefined();
  });
  test("Gemini cached counts and both SDK detail spellings are unknown, not full-rate", () => {
    const base = {
      promptTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }],
      candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 20 }],
    };
    for (const cached of [
      { cachedContentTokenCount: 25 },
      { cachedTokensDetails: [{ modality: "AUDIO", tokenCount: 25 }] },
      { cacheTokensDetails: [{ modality: "TEXT", tokenCount: 25 }] },
      { cachedContentTokenCount: -1 },
      { cachedContentTokenCount: 1.5 },
      { cachedTokensDetails: [{ modality: "AUDIO", tokenCount: -1 }] },
      { cacheTokensDetails: [{ modality: "TEXT", tokenCount: "12" }] },
      { promptTokensDetails: [{ modality: "TEXT", tokenCount: NaN }] },
      { candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 1.2 }] },
    ])
      expect(voiceCost("google", "gemini-3.8-live", { ...base, ...cached })).toBeUndefined();
    expect(voiceCost("google", "gemini-3.8-live", { ...base, cachedContentTokenCount: 0 })).toBeCloseTo(
      (100 * 3 + 20 * 4.5) / 1e6,
    );
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "gemini-3.8-live", (entry) => entries.push(entry));
    tracker.gemini(base);
    tracker.gemini({ ...base, cachedContentTokenCount: 25 });
    expect(entries).toEqual([{ cost: (100 * 3 + 20 * 4.5) / 1e6 }, { cost: 0, unknown: true }]);
    tracker.close();
    expect(entries).toHaveLength(2);
  });
  test("unknown usage/pricing is never recorded as zero", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "unpriced", (e) => entries.push(e));
    tracker.gemini({ promptTokensDetails: [] });
    tracker.close();
    expect(entries).toEqual([{ cost: 0, unknown: true }]);
    expect(voiceCost("openai", "gpt-live-1", {})).toBeUndefined();
  });
});
