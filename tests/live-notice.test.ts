import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("main Live startup does not show a redundant ownership notice", () => {
  const source = readFileSync(new URL("../src/live/extension.ts", import.meta.url), "utf8");
  expect(source).not.toContain("Live owns this session. Typed messages go to voice; /live stop returns to text. Speech interruption does not cancel work.");
  expect(source).toContain("if (this.gpt)");
});
