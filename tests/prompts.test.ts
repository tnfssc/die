import { expect, test } from "bun:test";
import {
  backgroundHandoff,
  collaborationGuidance,
  dieSystemPrompt,
  executeGuidance,
  executeReference,
  isDieSystemPrompt,
  mainAgentGuidance,
  subagentGuidance,
  workingValues,
} from "../src/prompts";

test("working values frame the agent separately from tool reference", () => {
  expect(executeGuidance).toEqual(executeReference);
  for (const value of workingValues) expect(collaborationGuidance()).toContain(value);
  for (const value of [
    "Quick work?",
    "Go look.",
    "Find simple way",
    "Share work.",
    "Solve real problem.",
    "Assume fresh start.",
  ])
    expect(workingValues.some((line) => line.startsWith(value))).toBe(true);
  const reference = executeReference.join("\n");
  for (const fact of [
    "shell 3 seconds",
    "subagent 1 second",
    "0 returns immediately",
    "background: true",
    "background: false",
    "defaults to true",
    "Set false at launch",
    "jobs.stop",
    "5,000",
    "session",
    "timeoutSeconds",
  ])
    expect(reference).toContain(fact);
});

test("background notice identifies jobs and deferred results without turn-management coaching", () => {
  expect(backgroundHandoff([])).toBe("");
  const text = backgroundHandoff(Array.from({ length: 30 }, (_, i) => "job_" + i));
  expect(text).toContain("job_19");
  expect(text).not.toContain("job_20");
  expect(text).toContain("10 more");
  expect(text).toContain("Results come later.");
  expect(text).not.toContain("await handoff(message)");
  expect(text).not.toContain("END YOUR TURN");
});

test("roles keep contribution prose without delegation commentary", () => {
  expect(subagentGuidance("fast")).toContain("Find answer. Show where it came from. Say what still guess.");
  expect(subagentGuidance("normal")).toContain("Work out what to change. Make it. Check it solves the problem.");
  expect(subagentGuidance("orchestrator")).toContain("Give workers clear jobs and room to think.");
  expect(subagentGuidance("orchestrator")).not.toContain("Fast/normal workers are available");
  expect(subagentGuidance("normal")).not.toContain("Delegation is disabled");
  const normal = subagentGuidance("normal");
  expect(normal).toBe(normal.trimEnd());
  for (const role of ["fast", "normal", "orchestrator"])
    expect(subagentGuidance(role)).not.toContain("Your assignment can span turns");
});

test("fast and normal root modes add no behavioral prose while retaining owned placeholders", () => {
  for (const mode of ["fast", "normal"] as const) {
    const guidance = mainAgentGuidance(mode, "test-owner");
    expect(guidance).toBe(
      "<!-- die:main-agent-mode:test-owner:start -->\n\n<!-- die:main-agent-mode:test-owner:end -->",
    );
    expect(guidance).not.toContain("You build and fix code");
    expect(guidance).not.toContain("main agent in fast instruction mode");
  }
  expect(mainAgentGuidance("orchestrator", "test-owner")).toContain(
    "You lead work. Give other agents clear jobs and room to think. Put their work together for user.",
  );
});

test("Markdown is the complete source of the system and tool guidance", async () => {
  const system = await Bun.file(new URL("../src/prompts/system.md", import.meta.url)).text();
  const reference = await Bun.file(new URL("../src/prompts/execute.md", import.meta.url)).text();
  expect(collaborationGuidance()).toBe(system.trimEnd());
  expect(executeGuidance.map((item) => "- " + item).join("\n")).toBe(reference.trimEnd());
  for (const role of ["fast", "normal", "orchestrator"]) expect(subagentGuidance(role)).not.toContain("{{");
});

test("wisdom guidance has one canonical Markdown source", async () => {
  const source = await Bun.file(new URL("../src/prompts/wisdom.md", import.meta.url)).text();
  expect(
    source.trimEnd(),
  ).toBe(`Next agent not hear whole talk. Save decisions, reasons, and where work stopped. No need copy whole conversation.

Work not done if next person cannot pick it up. Leave code and wisdom together, where others can get both. Say what finished and what still needs care.

Project wisdom lives in wisdom/. Put it with the feature or system it explains. Need past context? Read the wisdom that helps with this task.

Values live in wisdom/values.md. Read before big work. Missing? Build small set from wisdom already there. No make up past lessons. User's words come first.

Write wisdom? Look for lesson that belongs in values too. Before big work ends or changes hands, check what we learned. After release or broad review, look across the work too. Same lesson keeps coming back? Turn it into value. Link the wisdom it came from. Say when it helps and when it does not. Fix or join old values before adding more. New facts prove one wrong? Change it. Keep set small. One-time detail stays with feature. Nothing new? No need change values. At end, say what wisdom changed and what values changed. Values stayed same? Say why.

Write prompts and wisdom in same voice as rest. Short words. Short sentences. Plain talk. Read nearby text first. No formal policy talk. Keep exact names and facts when they matter.`);
});

test("Die base is a Pi custom prompt with execute guidance", () => {
  const prompt = dieSystemPrompt();
  expect(prompt).toStartWith('You help user build software. You work inside a coding tool named "die".');
  expect(prompt).not.toContain("Be concise in your responses");
  expect(prompt).not.toContain("Show file paths clearly when working with files");
  expect(prompt).not.toContain("Available tools:");
  expect(prompt).not.toContain("In addition to the tools above");
  expect(prompt).toContain("\n\nGuidelines:\n");
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
  expect(tool.promptSnippet).toBe("Run JS/TS.");
  expect(tool.description).toBe(source.trimEnd());
  expect(tool.description).toContain("4,000 characters");
  expect(tool.description).toContain("shared 10 MiB stdout/stderr capture limit");
  expect(tool.description).toContain("truncation is reported explicitly");
  expect(tool.description).toStartWith("Run JS/TS code in current directory.");
  expect(tool.description).toContain("call the shell() or subagent() globals inside execute");
  expect(tool.description).toContain("depends on the actual environment and result");
  expect(tool.description).not.toContain("handoff");
  expect(executeReference.join("\n")).toContain("Execution cancelled? Jobs already started");
});

test("worktree API facts stay in reference and isolation judgment stays in orchestrator roles", () => {
  const reference = executeReference.join("\n");
  expect(reference).toContain("title?, workspace?");
  expect(reference).toContain('{ kind: "inherit" }');
  expect(reference).toContain("one pinned commit");
  expect(reference).toContain("t3.json");
  const judgment = "Independent code or PR work? Give it a worktree.";
  expect(subagentGuidance("orchestrator")).toContain(judgment);
  expect(mainAgentGuidance("orchestrator", "workspace-test")).toContain(judgment);
  for (const role of ["fast", "normal"]) expect(subagentGuidance(role)).not.toContain(judgment);
  expect(collaborationGuidance()).not.toContain(judgment);
});

test("orchestrators use persistent worktree locations for ongoing work", () => {
  for (const guidance of [
    subagentGuidance("orchestrator"),
    mainAgentGuidance("orchestrator", "worktree-location-test"),
  ]) {
    expect(guidance).toContain('subagent({ workspace: { kind: "worktree" }, ... })');
    expect(guidance).toContain("Use the worktree path it returns");
    expect(guidance).toContain("Make manual worktrees in a place that lasts");
    expect(guidance).toContain("not \u0060/tmp\u0060 or \u0060/var/tmp\u0060");
    expect(guidance).toContain("DIE_WORKTREE_ROOT");
    expect(guidance).toContain("not code or release work still underway");
    expect(guidance).toContain("Save the worktree path and branch");
  }
});
