import { expect, test } from "bun:test";
import { gptLiveContext } from "../src/live/gpt-live-context";

test("voice observations are bounded UTF8 JSON data with explicit canonical provenance and loss", () => {
  for (const text of ["", "typed message", '\\"\n'.repeat(3000), "💬".repeat(3000)]) {
    const chunks = gptLiveContext(text);
    expect(chunks.length).toBeLessThanOrEqual(40);
    for (const [index, chunk] of chunks.entries()) {
      expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(480);
      const data = JSON.parse(chunk);
      expect(data.source).toBe("canonical_session");
      expect(data.untrustedData).toBe(true);
      expect(data.part).toBe(index + 1);
      expect(data.omittedCodePoints).toBe(Math.max(0, Array.from(text).length - 2400));
    }
    expect(chunks.map((chunk) => JSON.parse(chunk).data).join("")).toBe(Array.from(text).slice(-2400).join(""));
  }
});
