import { describe, expect, test } from "bun:test";
import { liveSystemInstruction } from "../src/live/prompt.js";

describe("Live voice instruction", () => {
  test("supports noncoding requests through the configured agent without promising access", () => {
    expect(liveSystemInstruction).toContain("not just coding");
    expect(liveSystemInstruction).toContain("weather");
    expect(liveSystemInstruction).toContain("agent_send");
    expect(liveSystemInstruction).toContain("Don't assume that agent has web access");
    expect(liveSystemInstruction).toContain("Ask for missing details");
  });
  test("distinguishes delivery from completion and doesn't claim unavailable speech", () => {
    expect(liveSystemInstruction).toContain("Only pass captured completed user speech");
    expect(liveSystemInstruction).toContain("ask the user to repeat");
    expect(liveSystemInstruction).toContain("Queued means queued");
    expect(liveSystemInstruction).toContain("Never invent progress");
    expect(liveSystemInstruction).toContain("not jobs");
    expect(liveSystemInstruction).toContain("job_cancel only for a user's explicit cancellation request");
  });
});
