import { expect, test } from "bun:test";
import { speakerCheckSummary } from "../src/live/speaker-summary";

test("summary keeps evidence actionable and unknown honest", () => {
  const text = speakerCheckSummary({ status: "no_signal" });
  expect(text).toContain("Do not treat it as an AEC pass");
  expect(text).toContain("native processing=unknown");
  expect(text).toContain("not a measured hardware render tap");
});
test("summary exposes measurement and processing without claiming absolute quality", () => {
  const text = speakerCheckSummary({
    status: "correlated_return",
    correlation: 0.6,
    lagMs: 70,
    baselineDbfs: -60,
    playbackDbfs: -42,
    tailDbfs: -60,
    processing: { voiceProcessingEnabled: true, voiceProcessingBypassed: false, captureRate: 48000, renderRate: 48000 },
  });
  expect(text).toContain("WebRTC APM prototype");
  expect(text).toContain("Reference correlation=0.6");
  expect(text).toContain("bypass=false");
  expect(text).toContain("48000Hz/unknown");
});
