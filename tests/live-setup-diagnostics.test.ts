import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { audioDiagnostic } from "../src/live/diagnostics";

test("startup graph ordering and catch-stage coverage", () => {
  const swift = readFileSync(new URL("../native/live/main.swift", import.meta.url), "utf8");
  const ordered = [
    "setVoiceProcessingEnabled(true)",
    "outputNode.inputFormat(forBus: 0)",
    "connect(audio.mainMixerNode, to: audio.outputNode",
    "audio.attach(source)",
    "audio.connect(source, to: audio.mainMixerNode",
    "audio.inputNode.installTap",
    "try audio.start()",
  ];
  let previous = -1;
  for (const item of ordered) {
    const index = swift.indexOf(item);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
  for (const stage of [
    "voice_processing",
    "input_format",
    "output_format",
    "output_connect",
    "source_attach",
    "source_connect",
    "tap_install",
    "engine_start",
  ]) {
    expect(swift).toContain(`phase = "${stage}"`);
    expect(audioDiagnostic(stage)).toContain("[" + stage + "]");
  }
  expect(audioDiagnostic("engine_start", { domain: "NSOSStatusErrorDomain", number: -10875 })).toContain(
    "NSOSStatusErrorDomain -10875",
  );
  expect(audioDiagnostic("engine_start", { domain: "private/device", number: 1 })).not.toContain("private");
  expect(audioDiagnostic("engine_start", { domain: "SECRET_TOKEN_123", number: 1 })).not.toContain("SECRET_TOKEN_123");
});
