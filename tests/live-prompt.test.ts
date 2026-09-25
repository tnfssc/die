import { describe, expect, test } from "bun:test";
import { orchestrationTools } from "../src/live/orchestration.js";
import liveSystemInstruction from "../src/prompts/live.md" with { type: "text" };

describe("Live voice instruction", () => {
  test("supports noncoding requests through the configured agent without promising access", () => {
    expect(liveSystemInstruction).toContain("not just coding");
    expect(liveSystemInstruction.toLowerCase()).toContain("weather");
    expect(liveSystemInstruction).toContain("agent_send");
    expect(liveSystemInstruction).toContain("Don't assume that agent has web access");
    expect(liveSystemInstruction).toContain("Ask for missing details");
  });
  test("delegates saving and research without requiring a model-written transcript", () => {
    expect(liveSystemInstruction).toContain("save this conversation, use agent_send");
    expect(liveSystemInstruction).toContain("do not need to write the transcript");
    const send = orchestrationTools.find((tool) => tool.name === "agent_send")!;
    expect(send.description).toContain("Host supplies captured speech");
    expect(send.description).toContain("received conversation context");
    expect(Object.keys((send.parametersJsonSchema as { properties: object }).properties)).toEqual(["requestId"]);
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
