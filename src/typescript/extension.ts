import executeDescription from "../prompts/execute-description.md" with { type: "text" };
import { executeGuidance, backgroundHandoff } from "../prompts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as z from "zod/mini";
import { toolParameters } from "../tool-schema";
import { executeInputPreview, executeOutputPreview } from "../ui/execution-previews";
import { executeIsolated, formatResult } from "./execution";
import { withJobCancellation } from "./job-bridge";

const HandoffParameters = z.object({ message: z.string().check(z.minLength(1), z.maxLength(2000)) });

const ExecuteParameters = z.object({
  code: z.string().check(z.describe("TypeScript source to transpile and execute")),
  timeoutSeconds: z.optional(z.number().check(z.minimum(0.1), z.describe("Optional execution timeout"))),
});

export function registerExecuteTool(
  pi: ExtensionAPI,
  jobHandler?: (ctx: ExtensionContext, method: string, params: unknown, signal: AbortSignal) => Promise<unknown>,
  executablePath?: string,
): void {
  const shutdown = new AbortController();
  const active = new Set<Promise<unknown>>();
  pi.on("session_shutdown", async () => {
    shutdown.abort();
    await Promise.allSettled([...active]);
  });

  pi.registerTool({
    name: "execute",
    label: "Execute",
    description: executeDescription.trimEnd(),
    promptSnippet: "Execute code for filesystem, process, and general coding operations",
    promptGuidelines: executeGuidance,
    parameters: toolParameters(ExecuteParameters),
    renderCall: (args, theme, context) =>
      executeInputPreview((args as { code?: unknown } | undefined)?.code, context.expanded, theme),
    renderResult: (result, options, theme, context) =>
      executeOutputPreview(result, options.expanded, context.isError, theme),
    async execute(_toolCallId, input, signal, _onUpdate, ctx) {
      const params = z.parse(ExecuteParameters, input);
      const backgroundIds: string[] = [];
      const handoffWaits = new AbortController();
      let handoffMessage: string | undefined;
      const execution = executeIsolated(
        params.code,
        ctx.cwd,
        signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal,
        params.timeoutSeconds ? params.timeoutSeconds * 1_000 : undefined,
        {
          executablePath,
          jobHandler: async (method, params, signal) => {
            if (method === "handoff") {
              const request = z.parse(HandoffParameters, params);
              if (!request.message.trim()) throw new Error("Handoff message is empty");
              if (handoffMessage !== undefined) throw new Error("This execute call already requested a handoff");
              handoffMessage = request.message;
              handoffWaits.abort(); // release outstanding foreground waits, not managed jobs
              return { accepted: true };
            }
            if (!jobHandler) throw new Error("Session job helpers are unavailable");
            const result = await jobHandler(ctx, method, params, withJobCancellation(signal, handoffWaits.signal));
            if (method === "shell" || method === "subagent") {
              for (const job of Array.isArray(result) ? result : [result]) {
                if (job && typeof job === "object" && job.background === true && typeof job.id === "string")
                  backgroundIds.push(job.id);
              }
            }
            return result;
          },
        },
      );
      active.add(execution);
      try {
        const result = await execution;
        let text = formatResult(result);
        const handoff = backgroundHandoff(backgroundIds);
        if (handoff) text += "\n\n" + handoff;
        if (
          handoffMessage !== undefined &&
          result.exitCode === 0 &&
          !result.timedOut &&
          !result.cancelled &&
          !result.imageError
        ) {
          text =
            "Execution handed off.\n\n" +
            handoffMessage +
            (result.stdout || result.stderr || result.images.length ? "\n\n" + text : "");
        }
        if (result.images.length && ctx.model && !ctx.model.input.includes("image")) {
          text +=
            "\n\nThe current model does not support images; attachments will be omitted from its request. Switch to an image-capable model to inspect them.";
        }
        // Pi marks tool failures only when execute throws, not via isError in
        // the returned object. Include bounded diagnostics in that exception.
        if (result.exitCode !== 0 || result.timedOut || result.cancelled || result.imageError) throw new Error(text);
        const { images, ...details } = result;
        return {
          content: [{ type: "text" as const, text }, ...images],
          ...(handoffMessage !== undefined ? { terminate: true } : {}),
          // Don't duplicate base64 payloads in persisted tool details.
          details: {
            ...details,
            ...(handoffMessage !== undefined ? { handoff: handoffMessage } : {}),
            backgroundJobs: backgroundIds,
            images: images.map((image) => ({
              mimeType: image.mimeType,
              bytes: Buffer.byteLength(image.data, "base64"),
            })),
          },
        };
      } finally {
        active.delete(execution);
      }
    },
  });
}
