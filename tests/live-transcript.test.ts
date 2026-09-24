import { expect, test } from "bun:test";
import { TranscriptLog, type TranscriptEntry } from "../src/live/transcript";

test("complete received text persists while viewport identifies clipped and omitted lines", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((e) => saved.push(e));
  const long = "x".repeat(3000);
  log.receive("You", { text: long.slice(0, 1000) });
  log.receive("You", { text: long.slice(1000), finished: true });
  expect(saved[0]).toEqual({ speaker: "You", text: long, status: "final" });
  expect(log.view((s) => s)[0]).toContain("earlier text saved");
  for (let i = 0; i < 40; i++) log.receive("Voice", { text: String(i), finished: true });
  expect(log.view((s) => s)[0]).toContain("Earlier conversation saved");
  expect(saved.length).toBe(41);
});

test("model-contract final segments are distinct; turn boundaries and interruptions do not imply hearing", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((e) => saved.push(e));
  log.receive("You", { text: "first", finished: true, finalitySource: "model_contract" });
  log.receive("You", { text: "second", finished: true, finalitySource: "model_contract" });
  log.receive("Voice", { text: "generated" });
  log.finish("Voice", "turn-boundary");
  log.receive("Voice", { text: "cancelled" });
  log.finish("Voice", "interrupted");
  expect(saved.map((e) => e.text)).toEqual(["first", "second", "generated", "cancelled"]);
  expect(saved.map((e) => e.status)).toEqual(["final", "final", "turn-boundary", "interrupted"]);
  expect(log.view((s) => s).join(" ")).toContain("Voice (interrupted): cancelled");
  expect(log.view((s) => s).join(" ")).not.toContain("hearing unverified");
  log.reset();
  expect(log.view((s) => s)).toEqual([]);
});

test("interleaved speakers persist in received order without dropping either speaker", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((e) => saved.push(e));
  log.receive("You", { text: "first " });
  log.receive("Voice", { text: "reply", finished: true });
  log.receive("You", { text: "last", finished: true });
  expect(saved.map((e) => [e.speaker, e.text])).toEqual([
    ["You", "first "],
    ["Voice", "reply"],
    ["You", "last"],
  ]);
  expect(saved[0].status).toBe("partial");
});

test("nonfinal input is persisted in bounded chunks without truncation", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((e) => saved.push(e));
  const text = "long ".repeat(10000);
  log.receive("You", { text });
  expect(saved.length).toBeGreaterThan(10);
  expect(saved.every((e) => e.text.length <= 4096 && e.status === "partial")).toBe(true);
  log.finish("You", "partial");
  expect(saved.map((e) => e.text).join("")).toBe(text);
});
