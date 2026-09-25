import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

test("shared session code has no provider or task implementation dependencies", async () => {
  for (const file of await readdir(new URL("../src/session/", import.meta.url))) {
    if (!file.endsWith(".ts")) continue;
    const source = await readFile(new URL("../src/session/" + file, import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:from\s+|import\s*\()["'](?:\.\.\/(?:live|tasks)\/|@google\/genai)/);
  }
});

test("tasks composes the session host without depending on voice", async () => {
  const source = await readFile(new URL("../src/tasks/extension.ts", import.meta.url), "utf8");
  expect(source).not.toContain('"../live/');
  expect(source).toContain('"../session/host"');
});
