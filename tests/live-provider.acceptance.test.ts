import { expect, test } from "bun:test";
import { createDefaultLiveCredentialService } from "../src/live/credentials";
import { VoiceSession } from "../src/live/session";
import { orchestrationTools } from "../src/live/orchestration";

// Explicit paid opt-in. Uses canonical provider auth; never imports a file or opens devices.
test.skipIf(process.env.DIE_RUN_GEMINI_LIVE_ACCEPTANCE !== "1")(
  "real Gemini accepts the native Live SDK session configuration",
  async () => {
    const controller = new AbortController();
    const credentials = await createDefaultLiveCredentialService(controller.signal);
    const key = await credentials.loadKey(controller.signal);
    const errors: string[] = [];
    const voice = new VoiceSession({ onError: (error) => errors.push(error.code) }, undefined, {
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
