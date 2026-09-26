import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLiveConfig, parseLiveConfig, saveLiveConfig } from "../src/live/config";
import { modelForProvider } from "../src/live/providers";

describe("Live voice settings (offline)", () => {
  test("missing file defaults Google; saved choice survives reload without a key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-live-config-"));
    const path = join(dir, "live-settings.json");
    try {
      const initial = await loadLiveConfig(path);
      expect(initial).toEqual({ provider: "google", model: "gemini-3.8-live" });
      const openai = { provider: "openai" as const, model: modelForProvider("openai", initial) };
      expect(openai.model).toBe("gpt-realtime-2.1");
      const chosen = {
        provider: "openai" as const,
        model: "gpt-realtime-2.1-mini" as const,
        openaiModel: "gpt-realtime-2.1-mini" as const,
      };
      await saveLiveConfig(chosen, path);
      expect(await loadLiveConfig(path)).toEqual(chosen);
      expect(modelForProvider("google", chosen)).toBe("gemini-3.8-live");
      expect(
        modelForProvider("openai", { provider: "google", model: "gemini-3.8-live", openaiModel: chosen.model }),
      ).toBe("gpt-realtime-2.1-mini");
      expect(await readFile(path, "utf8")).not.toContain("apiKey");
      const thinking = {
        provider: "google" as const,
        model: "gemini-3.8-live-extended-thinking" as const,
        googleModel: "gemini-3.8-live-extended-thinking" as const,
        openaiModel: chosen.model,
      };
      await saveLiveConfig(thinking, path);
      expect(await loadLiveConfig(path)).toEqual(thinking);
      expect(modelForProvider("openai", thinking)).toBe(chosen.model);
      expect(modelForProvider("google", { ...thinking, provider: "openai", model: chosen.model })).toBe(thinking.model);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("rejects mismatched and invented models instead of fallback", () => {
    for (const config of [
      { provider: "google", model: "gpt-live-1" },
      { provider: "openai", model: "gpt-live-1" },
      { provider: "openai", model: "gpt-realtime-2.1", openaiModel: "gpt-live-1" },
      { provider: "openai", model: "gemini-3.8-live" },
      { provider: "openai", model: "gpt-realtime-2.1-unknown" },
      { provider: "google", model: "gemini-3.8-live", openaiModel: "invented" },
      { provider: "google", model: "gemini-3.8-live", googleModel: "invented" },
      { provider: "openai", model: "gemini-3.8-live-extended-thinking" },
    ])
      expect(() => parseLiveConfig(config)).toThrow();
    expect(parseLiveConfig({ provider: "openai", model: "gpt-realtime-2.1-mini" })).toEqual({
      provider: "openai",
      model: "gpt-realtime-2.1-mini",
    });
  });
});
