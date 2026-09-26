/** Offline terminal fixture: exercise the real Pi owner delegation and renderer. */
import { acquireMainOwner } from "../../src/live/main-owner";
import { getInstructionContinuitySession } from "../../src/agent/instruction-continuity";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function (pi: any) {
  pi.on("session_start", (_event: any, ctx: any) => ctx.ui.notify("SPOKEN FIXTURE LOADED", "info"));
  pi.registerCommand("spokenfixture", {
    description: "Offline spoken turn through the paired coding owner",
    handler: async (_args: string, ctx: any) => {
      const owner = await acquireMainOwner(pi, ctx, { onContext: () => {}, onInput: () => {} });
      owner.delegatedVoice = true;
      const session = getInstructionContinuitySession(ctx.sessionManager) as any;
      session.agent.streamFunction = (model: any) => {
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            api: model.api,
            provider: model.provider,
            model: model.id,
            timestamp: Date.now(),
            stopReason: "stop",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            content: [{ type: "text", text: "OFFLINE_DELEGATED_REPLY" }],
          },
        });
        return stream;
      };
      // Do not inject the user text into the TUI: the paired owner must submit
      // it through the ordinary production session.prompt path.
      void owner.delegate!("fixture-spoken", "Check this repo status")
        .catch((error) => ctx.ui.notify("SPOKEN DELEGATION FAILED: " + error, "error"))
        .finally(() => owner.close());
    },
  });
}
