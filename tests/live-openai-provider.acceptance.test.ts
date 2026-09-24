import { expect, test } from "bun:test";
import { createDefaultLiveCredentialService } from "../src/live/credentials";
import { OpenAIVoiceSession as OpenAIRealtimeSession } from "../src/live/openai-session";
import { orchestrationTools } from "../src/live/orchestration";

// PAID, KEY-ACCESS OPT-IN: run only after explicit user consent. No devices,
// generated response, or real agent dispatch. Passing proves session setup only.
test.skipIf(process.env.DIE_RUN_OPENAI_LIVE_ACCEPTANCE !== "1")(
  "real OpenAI accepts the GA Live configuration and configured-agent tool schema",
  async () => {
    const controller = new AbortController();
    const credentials = await createDefaultLiveCredentialService(controller.signal, "openai");
    const key = await credentials.loadKey(controller.signal);
    const errors: string[] = [];
    const voice = new OpenAIRealtimeSession({ onError: (error) => errors.push(error.code) }, undefined, {
      tools: orchestrationTools,
      userTranscript() {},
      execute: async () => ({ status: "denied", reason: "Setup-only acceptance; no agent work" }),
    });
    try {
      await voice.connect(key);
      expect(errors).toEqual([]);
      expect(voice.state).toBe("ready");
    } finally {
      controller.abort();
      voice.close();
    }
    expect(voice.state).toBe("closed");
  },
  25_000,
);
