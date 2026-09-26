import { expect, test } from "bun:test";
import { gptLiveRequest } from "../src/live/gpt-live-request";
import type { DelegationSnapshot } from "../src/live/gpt-live-delegation";
const snapshot = (fragments: DelegationSnapshot["fragments"], omittedFragments = 0): DelegationSnapshot => ({
  delegationId: "internal-id",
  offsetMs: 100,
  revision: 1,
  fragments,
  omittedFragments,
  uncertain: true,
  hostContext: "INTERNAL_HOST_CONTEXT",
  hostContextOffsetMs: 0,
  contextClock: "local-capture-approximate",
});
test("ordinary speech has no transport wrapper or automatic policy sermon", () => {
  expect(
    gptLiveRequest(
      snapshot([
        { startMs: 1, endMs: 2, text: "Check this " },
        { startMs: 2, endMs: 3, text: "repo status" },
      ]),
    ),
  ).toBe("Check this repo status");
});
test("overlapping provisional alternatives are not fabricated into one command", () => {
  expect(
    gptLiveRequest(
      snapshot([
        { startMs: 1, endMs: 5, text: "Delete it" },
        { startMs: 2, endMs: 5, text: "Keep it" },
      ]),
    ),
  ).toBe("Delete it\nKeep it");
});
test("missing speech refuses a partial request; retained speech is never sliced again", () => {
  expect(gptLiveRequest(snapshot([], 3))).toBe("");
  expect(gptLiveRequest(snapshot([{ startMs: 1, endMs: 2, text: "remaining speech" }], 1))).toBe("");
  expect(gptLiveRequest(snapshot([{ startMs: 1, endMs: 2, text: "a".repeat(5000) }]))).toBe("a".repeat(5000));
});
