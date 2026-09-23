import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collaborationGuidance } from "../src/prompts";
import { registerCacheAffineCompaction } from "../src/tasks/cache-affine-compaction";
import { registerExecuteTool } from "../src/typescript/extension";

// Test Phase 1 alone now that production Codex uses Phase 2. This fixture does
// not switch or downgrade Codex at runtime.
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
