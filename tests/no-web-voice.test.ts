import { expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { LIVE_PROVIDERS } from "../src/live/providers";

const root = resolve(import.meta.dir, "..");
const patch = readFileSync(resolve(root, "integrations/t3/upstream/die.patch"), "utf8");

test("maintained web patch retains web runtime without voice routes, controls or FD bridge", () => {
  expect(patch).toContain("apps/server/src/auth/DieWebAuth.ts");
  expect(patch).toContain("apps/web/src/");
  expect(patch).not.toMatch(
    /DIE_WEB_VOICE|PiVoiceChannels|VoiceRoute|VoiceControls|src\/live\/controller|src\/voice\//i,
  );
  const files = [...patch.matchAll(/^diff --git a\/(.*?) b\//gm)].map((match) => match[1]);
  expect(files.some((file) => file.startsWith("apps/web/src/"))).toBe(true);
  expect(files.some((file) => /(?:^|\/)(?:voice|live)(?:\/|\.)/i.test(file))).toBe(false);
  for (const path of ["src/live/web-ipc-bridge.ts", "src/live/web-relay.ts", "web/live/controller.ts"])
    expect(existsSync(resolve(root, path))).toBe(false);
});

test("CLI /live retains Gemini and OpenAI realtime models without retired GPT-Live", () => {
  expect(LIVE_PROVIDERS.google.models).toContain("gemini-3.8-live");
  expect(LIVE_PROVIDERS.openai.models).toEqual(["gpt-realtime-2.1", "gpt-realtime-2.1-mini"]);
});
