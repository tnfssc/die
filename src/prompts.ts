import identity from "./prompts/identity.md" with { type: "text" };
import system from "./prompts/system.md" with { type: "text" };
import reference from "./prompts/execute.md" with { type: "text" };
import handoff from "./prompts/background-handoff.md" with { type: "text" };
import fast from "./prompts/fast.md" with { type: "text" };
import normal from "./prompts/normal.md" with { type: "text" };
import orchestrator from "./prompts/orchestrator.md" with { type: "text" };
import delegationEnabled from "./prompts/delegation-enabled.md" with { type: "text" };
import delegationDisabled from "./prompts/delegation-disabled.md" with { type: "text" };
import mainFast from "./prompts/main-fast.md" with { type: "text" };
import mainNormal from "./prompts/main-normal.md" with { type: "text" };
import mainOrchestrator from "./prompts/main-orchestrator.md" with { type: "text" };

// Text imports embed the Markdown in the standalone executable.
const bullets = (text: string): string[] => text.split("\n").filter(line => line.startsWith("- ")).map(line => line.slice(2));
export const workingValues = bullets(system);
// Remove only list markers that Pi adds back; preserve wrapped lines and paragraphs.
export const executeReference = reference.trimEnd().split(/\n(?=- )/).map(item => item.replace(/^- /, ""));
export const executeGuidance = executeReference;
export const backgroundWorkflowExample = system.trimEnd().split("\n\n").at(-1)!;

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
  return template.trimEnd().replace("{{role}}", () => role).replace("{{delegation}}", () => (canDelegate ? delegationEnabled : delegationDisabled).trimEnd());
}

export const MAIN_AGENT_MODES = ["fast", "normal", "orchestrator"] as const;
export type MainAgentMode = typeof MAIN_AGENT_MODES[number];
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

/** Adapt only the upstream default block; callers leave user system prompts alone. */
export function productSystemPrompt(prompt: string): string {
  if (!prompt.startsWith("You are an expert coding assistant operating inside pi,")) return prompt;
  const start = prompt.indexOf("\n\nPi documentation (read only when the user asks about pi itself,");
  const last = start < 0 ? -1 : prompt.indexOf("\n- Always read pi .md files completely and follow links to related docs", start);
  if (last >= 0) {
    const end = prompt.indexOf("\n", last + 1);
    prompt = prompt.slice(0, start) + (end < 0 ? "" : prompt.slice(end));
  }
  return prompt.replace(/^You are an expert coding assistant operating inside pi,[^\n]*/, () => identity.trimEnd());
}
