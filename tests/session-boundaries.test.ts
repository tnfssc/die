import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

test("shared session code has no provider or task implementation dependencies", async () => {
  for (const file of await readdir(new URL("../src/session/", import.meta.url))) {
    if (!file.endsWith(".ts")) continue;
    const source = await readFile(new URL("../src/session/" + file, import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:from\s+|import\s*\()["'](?:\.\.\/(?:live|tasks)\/|@google\/genai)/);
  }
});

test("agent runtime composes the shared owner without depending on provider implementations", async () => {
  const source = await readFile(new URL("../src/agent/extension.ts", import.meta.url), "utf8");
  expect(source).toContain('"../live/main-owner"');
  expect(source).not.toMatch(/(?:@google\/genai|live\/(?:session|openai-session|gpt-live-session))/);
  expect(source).toContain('"../session/host"');
});

test("history reads shake records without loading the agent command", async () => {
  const source = await readFile(new URL("../src/history/service.ts", import.meta.url), "utf8");
  expect(source).toContain('"./shake-record"');
  expect(source).not.toContain("agent/manual-shake");
});
