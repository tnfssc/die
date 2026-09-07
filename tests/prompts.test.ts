import { expect, test } from "bun:test";
import {
  backgroundHandoff,
  backgroundWorkflowExample,
  collaborationGuidance,
  dieSystemPrompt,
  executeGuidance,
  executeReference,
  isDieSystemPrompt,
  subagentGuidance,
  workingValues,
} from "../src/prompts";

test("working values frame the agent separately from tool reference", () => {
  expect(executeGuidance).toEqual(executeReference);
  for (const value of workingValues) expect(collaborationGuidance()).toContain(value);
  expect(backgroundWorkflowExample).toStartWith("A typical decision point:");
  expect(executeReference.join("\n")).toContain(backgroundWorkflowExample);
  expect(collaborationGuidance()).not.toContain(backgroundWorkflowExample);
  for (const value of [
    "Responsive collaboration",
    "Purposeful attention",
    "Evidence-led communication",
    "Proportionate effort",
    "Clear ownership",
  ])
    expect(workingValues.some((line) => line.startsWith(value))).toBe(true);
  const reference = executeReference.join("\n");
  for (const fact of [
    "shell defaults to 3 seconds",
    "subagent to 1 second",
    "0 gives immediate handoff",
    "background:true",
    "background:false",
    "jobs.stop",
    "5,000",
    "session",
    "timeoutSeconds",
  ])
    expect(reference).toContain(fact);
});

test("handoff supplies ownership and a reason to return control without shouted commands", () => {
  expect(backgroundHandoff([])).toBe("");
  const text = backgroundHandoff(Array.from({ length: 30 }, (_, i) => "job_" + i));
  expect(text).toContain("job_19");
  expect(text).not.toContain("job_20");
  expect(text).toContain("10 more");
  expect(text).toContain("automatically");
  expect(text).toContain("responsive");
  expect(text).not.toContain("END YOUR TURN");
});

test("roles describe their contribution while retaining capability facts", () => {
  expect(subagentGuidance("fast", false)).toContain("focused reconnaissance");
  expect(subagentGuidance("normal", false)).toContain("independent judgment");
  expect(subagentGuidance("orchestrator", true)).toContain("room for judgment");
  expect(subagentGuidance("orchestrator", true)).toContain("Fast/normal workers are available");
  expect(subagentGuidance("normal", false)).toContain("Delegation is disabled");
});

test("Markdown is the complete source of the system and tool guidance", async () => {
  const system = await Bun.file(new URL("../src/prompts/system.md", import.meta.url)).text();
  const reference = await Bun.file(new URL("../src/prompts/execute.md", import.meta.url)).text();
  expect(collaborationGuidance()).toBe(system.trimEnd());
  expect(executeGuidance.map((item) => "- " + item).join("\n")).toBe(reference.trimEnd());
  for (const role of ["fast", "normal", "orchestrator"])
    for (const delegate of [false, true]) expect(subagentGuidance(role, delegate)).not.toContain("{{");
});

test("Die base is a Pi custom prompt with execute guidance", () => {
  const prompt = dieSystemPrompt();
  expect(prompt).toStartWith("You are an expert coding assistant operating inside die,");
  expect(prompt).toContain("Available tools:\n- execute:");
  for (const item of executeGuidance) expect(prompt).toContain("- " + item);
  expect(prompt).not.toContain("Current working directory:");
  expect(isDieSystemPrompt({ customPrompt: prompt })).toBe(true);
  expect(isDieSystemPrompt({ customPrompt: "user-owned" })).toBe(false);
  expect(isDieSystemPrompt(undefined)).toBe(false);
});

test("execute tool description uses the embedded Markdown source", async () => {
  const { registerExecuteTool } = await import("../src/typescript/extension");
  let tool: any;
  registerExecuteTool({
    on() {},
    registerTool(value: unknown) {
      tool = value;
    },
  } as any);
  const source = await Bun.file(new URL("../src/prompts/execute-description.md", import.meta.url)).text();
  expect(tool.description).toBe(source.trimEnd());
  expect(tool.description).toContain("24,000 bytes");
  expect(tool.description).toContain("Input is a single `code` string");
  expect(tool.description).not.toContain("shell(");
  expect(tool.description).not.toContain("handoff");
  expect(executeReference.join("\n")).toContain("process group");
});
