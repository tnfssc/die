/** Keep execute as the only model-visible tool and teach it the T3 bridge API. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const bridgeClient = resolve(dirname(fileURLToPath(import.meta.url)), "bridge-client.ts");

export default function configureT3ExecuteBridge(pi: ExtensionAPI) {
  if (!process.env.T3_MCP_URL || !process.env.T3_MCP_BEARER_TOKEN) return;
  pi.on("before_agent_start", (event) => {
    // PiAdapterV2's injected extension remains loaded (including approval hooks),
    // but its MCP registrations are not model-visible. Delegation crosses the
    // endpoint only from a real execute invocation.
    pi.setActiveTools(["execute"]);
    return {
      systemPrompt: event.systemPrompt +
        `\n\nT3-owned delegation is available from execute. In execute code, import { delegateTask, taskStatus, taskCancel } from ${JSON.stringify(bridgeClient)}, then call await delegateTask({ task, mode: "async" | "wait" }). Print or otherwise use the returned result (task identity is in structuredContent). Use taskStatus(taskId) to recover results across execute invocations and taskCancel(taskId) to interrupt. Supply a stable clientRequestId when retrying delegateTask to prevent a duplicate T3 task. Do not call subagent() for the same task. The injected T3 extension stays loaded for approval hooks, but its MCP tools are intentionally not model-visible.`,
    };
  });
}
