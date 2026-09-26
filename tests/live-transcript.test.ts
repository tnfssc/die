import { expect, test } from "bun:test";
import { LiveFragmentGroups } from "../src/live/transcript";
import { TranscriptLog, type TranscriptEntry } from "../src/session/transcript";

test("complete received text persists while viewport clips long lines without history banner", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((e) => saved.push(e));
  const long = "x".repeat(3000);
  log.receive("You", { text: long.slice(0, 1000) });
  log.receive("You", { text: long.slice(1000), finished: true });
  expect(saved[0]).toEqual({ speaker: "You", text: long, status: "final" });
  expect(log.view((s) => s)[0]).toContain("earlier text saved");
  for (let i = 0; i < 40; i++) log.receive("Voice", { text: String(i), finished: true });
  expect(log.view((s) => s)).toHaveLength(4);
  expect(log.view((s) => s).join("\n")).not.toContain("Earlier conversation saved");
  expect(saved).toHaveLength(41);
});

test("model-contract final segments are distinct; turn boundaries and interruptions do not imply hearing", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((e) => saved.push(e));
  log.receive("You", { text: "first", finished: true, replace: true });
  log.receive("You", { text: "second", finished: true, replace: true });
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

test("exactly full final chunks retain their final boundary", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((e) => saved.push(e));
  log.receive("You", { text: "a".repeat(4096), finished: true });
  log.receive("Voice", { text: "b".repeat(8192), finished: true });
  expect(saved.map((e) => [e.speaker, e.text.length, e.status])).toEqual([
    ["You", 4096, "final"],
    ["Voice", 4096, "partial"],
    ["Voice", 4096, "final"],
  ]);
});

test("GPT-Live groups adjacent provisional deltas by speaker and timestamp without declaring final ASR", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((e) => saved.push(e));
  const groups = new LiveFragmentGroups((speaker, text, status) => {
    log.receive(speaker, { text });
    log.finish(speaker, status);
  });
  const add = (speaker: "You" | "Voice", delta: string, startMs: number, endMs: number, suppressed = false) =>
    groups.receive(speaker, { delta, startMs, endMs }, suppressed);
  add("You", "please ", 0, 160);
  add("You", "check", 161, 380);
  add("Voice", "Checking", 400, 500);
  add("You", "later", 510, 600); // speaker switch, not a correction to old entry
  add("You", " on Friday", 601, 700);
  add("You", " new request", 1400, 1500); // gap
  add("Voice", "not played", 1501, 1600, true);
  groups.flush();
  expect(saved).toEqual([
    { speaker: "You", text: "please check", status: "partial" },
    { speaker: "Voice", text: "Checking", status: "partial" },
    { speaker: "You", text: "later on Friday", status: "partial" },
    { speaker: "You", text: " new request", status: "partial" },
    { speaker: "Voice", text: "not played", status: "suppressed" },
  ]);
});

test("GPT-Live groups bound duration and size, and idle pause saves final provisional group", async () => {
  const saved: string[] = [];
  const groups = new LiveFragmentGroups((_speaker, text, status) => {
    expect(status).toBe("partial");
    saved.push(text);
  }, 15);
  groups.receive("You", { delta: "a".repeat(3000), startMs: 0, endMs: 100 });
  groups.receive("You", { delta: "b".repeat(2000), startMs: 100, endMs: 200 });
  groups.receive("You", { delta: "c", startMs: 200, endMs: 2701 });
  await Bun.sleep(40);
  expect(saved).toEqual(["a".repeat(3000), "b".repeat(2000), "c"]);
  groups.flush();
  expect(saved.length).toBe(3);
});

test("late GPT-Live corrections keep arrival order without joining a newer time span", () => {
  const saved: string[] = [];
  const groups = new LiveFragmentGroups((_speaker, text) => saved.push(text));
  groups.receive("You", { delta: "newer", startMs: 3000, endMs: 3100 });
  groups.receive("You", { delta: "older correction", startMs: 100, endMs: 200 });
  groups.flush();
  expect(saved).toEqual(["newer", "older correction"]);
});

test("finishing a live voice draft does not shrink the transcript widget", () => {
  const log = new TranscriptLog(() => {});
  for (let i = 0; i < 5; i++) log.receive("You", { text: `turn ${i}`, finished: true });
  log.receive("Voice", { text: "reply in progress" });
  const speaking = log.view((text) => text);
  expect(speaking).toEqual([
    "You: turn 2",
    "You: turn 3",
    "You: turn 4",
    "Voice: reply in progress",
  ]);
  log.finish("Voice", "turn-boundary");
  expect(log.view((text) => text)).toEqual(speaking);
});
