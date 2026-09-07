import type { BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import handoff from "./prompts/background-handoff.md" with { type: "text" };
import delegationDisabled from "./prompts/delegation-disabled.md" with { type: "text" };
import delegationEnabled from "./prompts/delegation-enabled.md" with { type: "text" };
import reference from "./prompts/execute.md" with { type: "text" };
import fast from "./prompts/fast.md" with { type: "text" };
import identity from "./prompts/identity.md" with { type: "text" };
import mainFast from "./prompts/main-fast.md" with { type: "text" };
import mainNormal from "./prompts/main-normal.md" with { type: "text" };
import mainOrchestrator from "./prompts/main-orchestrator.md" with { type: "text" };
import normal from "./prompts/normal.md" with { type: "text" };
import orchestrator from "./prompts/orchestrator.md" with { type: "text" };
import system from "./prompts/system.md" with { type: "text" };

// Text imports embed the Markdown in the standalone executable.
const bullets = (text: string): string[] =>
  text
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
export const workingValues = bullets(system);
// Remove only list markers that Pi adds back; preserve wrapped lines and paragraphs.
export const executeReference = reference
  .trimEnd()
  .split(/\n(?=- )/)
  .map((item) => item.replace(/^- /, ""));
export const executeGuidance = executeReference;
export const backgroundWorkflowExample =
  reference.match(/  A typical decision point:.*$/m)?.[0].trim() ?? "";

export function collaborationGuidance(): string {
  return system.trimEnd();
}

export function backgroundHandoff(ids: string[]): string {
  if (!ids.length) return "";
  const names = ids.slice(0, 20).join(", ") + (ids.length > 20 ? " (and " + (ids.length - 20) + " more)" : "");
  return handoff.trimEnd().replace("{{jobs}}", () => names);
}

export function subagentGuidance(role: string, canDelegate: boolean): string {
  const template = role === "fast" ? fast : role === "orchestrator" ? orchestrator : normal;
  return template
    .trimEnd()
    .replace("{{role}}", () => role)
    .replace("{{delegation}}", () => (canDelegate ? delegationEnabled : delegationDisabled).trimEnd());
}

export const MAIN_AGENT_MODES = ["fast", "normal", "orchestrator"] as const;
export type MainAgentMode = (typeof MAIN_AGENT_MODES)[number];
function mainModeMarkers(owner: string): [string, string] {
  // owner is generated internally, not derived from project or user text.
  return [`<!-- die:main-agent-mode:${owner}:start -->`, `<!-- die:main-agent-mode:${owner}:end -->`];
}

export function mainAgentGuidance(mode: MainAgentMode, owner: string): string {
  const source = mode === "fast" ? mainFast : mode === "normal" ? mainNormal : mainOrchestrator;
  const [start, end] = mainModeMarkers(owner);
  return start + "\n" + source.trimEnd() + "\n" + end;
}

/** Replace only the region carrying this die session's unguessable owner marker. */
export function replaceMainAgentGuidance(prompt: string, mode: MainAgentMode, owner: string): string {
  const [startMarker, endMarker] = mainModeMarkers(owner);
  const start = prompt.indexOf(startMarker);
  if (start < 0) return prompt;
  const end = prompt.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return prompt;
  return prompt.slice(0, start) + mainAgentGuidance(mode, owner) + prompt.slice(end + endMarker.length);
}

export const executeToolSnippet = "Execute code for filesystem, process, and general coding operations";

/**
 * Die's base prompt, supplied to Pi as its structured custom prompt. Pi remains
 * responsible for appending user additions, project context, skills, and cwd.
 */
export function dieSystemPrompt(): string {
  const guidelines = [
    ...executeGuidance,
    "Be concise in your responses",
    "Show file paths clearly when working with files",
  ];
  return (
    identity.trimEnd() +
    "\n\nAvailable tools:\n- execute: " +
    executeToolSnippet +
    "\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.\n\nGuidelines:\n" +
    guidelines.map((line) => "- " + line).join("\n")
  );
}

/** True only for Die's injected base; all other custom prompts are user-owned. */
export function isDieSystemPrompt(options: Pick<BuildSystemPromptOptions, "customPrompt"> | undefined): boolean {
  return options?.customPrompt === dieSystemPrompt();
}
