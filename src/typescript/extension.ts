import { diagnosticRecorder, inspectDiagnostics } from "../diagnostics";
import executeDescription from "../prompts/execute-description.md" with { type: "text" };
import { executeGuidance, backgroundHandoff } from "../prompts";
import { SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
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
  outputPad?: (cwd: string) => number,
): void {
  // pi 0.85 exposes outputPad through its public SettingsManager but not in
  // ToolRenderContext. Remove this narrow compatibility seam when the context
  // carries the setting directly. Cache just as InteractiveMode does at startup.
  const outputPads = new Map<string, number>();
  const getOutputPad =
    outputPad ??
    ((cwd: string) => {
      let padding = outputPads.get(cwd);
      if (padding === undefined) {
        padding = SettingsManager.create(cwd).getOutputPad();
        outputPads.set(cwd, padding);
      }
      return padding;
    });
  let shutdown = new AbortController();
  pi.on("session_start", () => {
    if (shutdown.signal.aborted) shutdown = new AbortController();
  });
  const active = new Set<Promise<unknown>>();
  pi.on("session_shutdown", async () => {
    shutdown.abort("shutdown");
    await Promise.allSettled([...active]);
  });

  pi.registerTool({
    name: "execute",
    label: "Execute",
    description: executeDescription.trimEnd(),
    promptSnippet: "Execute code for filesystem, process, and general coding operations",
    promptGuidelines: executeGuidance,
    parameters: toolParameters(ExecuteParameters),
    renderShell: "self",
    renderCall: (args, theme, context) =>
      executeInputPreview(
        (args as { code?: unknown } | undefined)?.code,
        context.expanded,
        theme,
        context.state,
        context.executionStarted,
        getOutputPad(context.cwd),
      ),
    renderResult: (result, options, theme, context) =>
      executeOutputPreview(
        result,
        options.expanded,
        context.isError,
        theme,
        (context.args as { code?: unknown } | undefined)?.code,
        context.state,
        getOutputPad(context.cwd),
      ),
    async execute(_toolCallId, input, signal, _onUpdate, ctx) {
      const params = z.parse(ExecuteParameters, input);
      const owner = ctx.sessionManager;
      const ownerSessionId = owner?.getSessionId?.();
      const recordForAttachment = owner ? diagnosticRecorder(owner) : undefined;
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
        const diagnostics = inspectDiagnostics(result).records;
        try {
          if (owner && owner.getSessionId?.() === ownerSessionId) {
            for (const diagnostic of diagnostics) recordForAttachment?.(diagnostic);
          }
        } catch {
          // Diagnostics are best effort when session ownership metadata is unavailable.
        }
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
            ...(diagnostics.length ? { diagnostics } : {}),
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
