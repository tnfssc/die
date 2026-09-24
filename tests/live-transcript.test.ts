import { expect, test } from "bun:test";
import { TranscriptLog, type TranscriptEntry } from "../src/live/transcript";

test("complete received text persists while viewport identifies clipped and omitted lines", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog(e => saved.push(e));
  const long = "x".repeat(2000);
  log.receive("You", { text: long.slice(0, 1000) });
  log.receive("You", { text: long.slice(1000), finished: true });
  expect(saved[0]).toEqual({ speaker: "You", text: long, status: "final" });
  expect(log.view(s => s)[0]).toContain("1300 chars not shown here");
  for (let i = 0; i < 40; i++) log.receive("Voice", { text: String(i), finished: true });
  expect(log.view(s => s)[0]).toContain("earlier transcript entries not shown");
  expect(saved.length).toBe(41);
});

test("model-contract final segments are distinct; turn boundaries and interruptions do not imply hearing", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog(e => saved.push(e));
  log.receive("You", { text: "first", finished: true, finalitySource: "model_contract" });
  log.receive("You", { text: "second", finished: true, finalitySource: "model_contract" });
  log.receive("Voice", { text: "generated" });
  log.finish("Voice", "turn-boundary");
  log.receive("Voice", { text: "cancelled" });
  log.finish("Voice", "interrupted");
  expect(saved.map(e => e.text)).toEqual(["first", "second", "generated", "cancelled"]);
  expect(saved.map(e => e.status)).toEqual(["final", "final", "turn-boundary", "interrupted"]);
  expect(log.view(s => s).join(" ")).toContain("hearing unverified");
  log.reset();
  expect(log.view(s => s)).toEqual([]);
});
