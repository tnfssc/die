import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collaborationGuidance } from "../src/prompts";
import { registerCacheAffineCompaction } from "../src/tasks/cache-affine-compaction";
import { registerExecuteTool } from "../src/typescript/extension";

// Exercise the Phase 1 strategy independently now that production Codex uses
// Phase 2. This is a test fixture, not a runtime switch that downgrades Codex.
export default function phase1CompactionFixture(pi: ExtensionAPI) {
  registerExecuteTool(pi);
  registerCacheAffineCompaction(pi);
  pi.on("session_start", () => pi.setActiveTools(["execute"]));
  pi.on("before_agent_start", (event) =>
    event.systemPromptOptions?.customPrompt
      ? undefined
      : { systemPrompt: event.systemPrompt + "\n\n" + collaborationGuidance() },
  );
}
