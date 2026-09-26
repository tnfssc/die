import { expect, test } from "bun:test";
import { gptLiveContext } from "../src/live/gpt-live-context";

test("voice observations are bounded, quoted, and mark truncation without per-chunk JSON", () => {
  expect(gptLiveContext("")).toEqual([]);
  for (const text of ["typed message", '\\"\n'.repeat(3000), "💬".repeat(3000)]) {
    const chunks = gptLiveContext(text);
    expect(chunks.length).toBeLessThanOrEqual(40);
    for (const chunk of chunks) expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(480);
    expect(chunks[0]).toContain("Quoted session observation");
    const omitted = Math.max(0, Array.from(text).length - 2400);
    if (omitted) expect(chunks[0]).toContain(`${omitted} earlier code points omitted`);
    expect(
      chunks
        .join("")
        .replace(/^Quoted session observation(?: \(.*?\))?:\n/, "")
        .replaceAll("Observation continued:\n", ""),
    ).toBe(Array.from(text).slice(-2400).join(""));
  }
});
