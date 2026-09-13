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

test("memory consolidation worker prose has one canonical Markdown source", async () => {
  const source = await Bun.file(new URL("../src/prompts/memory-consolidation.md", import.meta.url)).text();
  expect(source.trimEnd()).toBe(`Read pending notes. Merge what's useful into project memory.

User constraints (authoritative; preserve exactly):
{{constraints}}

Pending note paths available at launch:
{{paths}}

Work inside {{cwd}}/.agents/notes. Group related notes, merge repeats, keep it short.
Keep .agents/notes/index.md short. Point to deeper notes; add small topic index.md files when useful.

Save notes first. Then write {{receipt}} listing every saved non-hidden Markdown file and its SHA-256 hash, including index.md. Die handles marking pending notes consumed.

JSON format (paths relative to .agents/notes):
{"files":[{"path":"index.md","sha256":"<hash of saved bytes>"}]}`);
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
  expect(tool.description).toContain("saved in full to files");
  expect(tool.description).toStartWith("Run JS/TS code in current directory.");
  expect(tool.description).not.toContain("shell(");
  expect(tool.description).not.toContain("handoff");
  expect(executeReference.join("\n")).toContain("Execution cancelled? Jobs already started");
});
