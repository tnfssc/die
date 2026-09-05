import { subagentGuidance, collaborationGuidance, productSystemPrompt } from "../prompts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CompletionBatcher } from "./completion-batcher";
import { formatCompletionNotification } from "./completion-notification";
import { TaskManager, type TaskInspection } from "./task-manager";
import { registerExecuteTool } from "../typescript/extension";
import { SUBAGENT_TYPES, canDelegate } from "./subagent-profiles";
import { registerSubagentSettings } from "./subagent-settings-ui";
import { completionPreview } from "../ui/execution-previews";
import { createCompactUI } from "../ui/footer";
import { JobService } from "./job-service";
import { clearInstructionContinuity, registerCacheAffineCompaction, scopeInstructionContinuity } from "./cache-affine-compaction";
import { registerNativeCodexCompaction } from "./native-compaction";
import { registerTaskMonitor } from "./task-monitor";
import { registerResumeSafeguards } from "./resume-safeguards";
import { registerInstructionMode } from "./instruction-mode";
import { CacheCountdown, registerCacheCountdown } from "./cache-countdown";

export default function asynchronousTasksExtension(pi: ExtensionAPI, options: { profilesPath?: string; cacheSettingsPath?: string } = {}): void {
  const cacheCountdown = new CacheCountdown();
  registerCacheCountdown(pi, cacheCountdown, options.cacheSettingsPath);
  const installUI = createCompactUI(pi, cacheCountdown);
  pi.registerMessageRenderer("task-complete", (message, options, theme) =>
    completionPreview(message.content, options.expanded, theme, options.outputPad));
  registerSubagentSettings(pi, options.profilesPath);
  // Environment identity is the floor for genuinely spawned child processes.
  // A root process may switch among root and child sessions in the same closure.
  const environmentDepth = Math.max(0, Number.parseInt(process.env.DIE_SUBAGENT_DEPTH ?? "0", 10) || 0);
  const rawEnvironmentType = process.env.DIE_SUBAGENT_TYPE;
  const environmentType = SUBAGENT_TYPES.includes(rawEnvironmentType as typeof SUBAGENT_TYPES[number])
    ? rawEnvironmentType
    : undefined;
  let subagentDepth = environmentDepth;
  let agentType = environmentType;
  let canSpawnSubagent = canDelegate(subagentDepth, agentType);
  const instructionMode = registerInstructionMode(pi, () => subagentDepth === 0);
  const restoreAgentIdentity = (ctx: ExtensionContext) => {
    const sessionManager = ctx.sessionManager as { getBranch?: () => any[]; getEntries?: () => any[] } | undefined;
    const entries = sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
    const entry = entries.find(entry => entry.type === "custom" && entry.customType === "die-agent");
    const data = entry?.type === "custom" ? entry.data as { type?: string; depth?: number } | undefined : undefined;
    const validChild = data && SUBAGENT_TYPES.includes(data.type as typeof SUBAGENT_TYPES[number])
      && Number.isInteger(data.depth) && data.depth! >= 1;
    if (validChild && data.depth! >= environmentDepth) {
      // A spawned process may resume/fork deeper metadata, but its actual role
      // is a capability cap: session metadata cannot turn a leaf into an
      // orchestrator (or change an orchestrator into a different role). Root
      // processes intentionally remain free to traverse session identities.
      agentType = environmentDepth > 0 && environmentType ? environmentType : data.type;
      subagentDepth = data.depth!;
    } else {
      // No active-branch child metadata means root in a root process. Do not
      // retain identity from a previously resumed child session.
      agentType = environmentType;
      subagentDepth = environmentDepth;
    }
    canSpawnSubagent = canDelegate(subagentDepth, agentType);
  };
  let manager: TaskManager | undefined;
  registerNativeCodexCompaction(pi, () => manager?.list().filter(task => task.status === "running")
    .map(({id,kind,status}) => ({id,kind,status})) ?? []);
  registerCacheAffineCompaction(pi, () => manager?.list().filter(task => task.status === "running")
    .map(({id,kind,status}) => ({id,kind,status})) ?? [], { skipCodexNative: true });
  let taskUi: ExtensionContext["ui"] | undefined;
  const updateTaskStatus = () => {
    const running = manager?.list().filter((task) => task.status === "running").length ?? 0;
    taskUi?.setStatus("die-tasks", running > 0 ? `${running} task${running === 1 ? "" : "s"} running` : undefined);
  };

  const completions = new CompletionBatcher<TaskInspection>((tasks) => {
    updateTaskStatus();
    const summaries = tasks.map(({ output: _output, ...summary }) => summary);
    pi.sendMessage(
      {
        customType: "task-complete",
        content: formatCompletionNotification(tasks),
        display: true,
        details: { tasks: summaries },
      },
      { deliverAs: "steer", triggerTurn: true },
    );
  });

  const getManager = () => {
    manager ??= new TaskManager((task) => completions.add(task));
    return manager;
  };

  registerTaskMonitor(pi, getManager);
  registerResumeSafeguards(pi);

  let service: JobService | undefined;
  registerExecuteTool(pi, (ctx, method, params, signal) => {
    taskUi = ctx.ui;
    service ??= new JobService(getManager(), () => ({ depth: subagentDepth, type: agentType }), updateTaskStatus, options.profilesPath);
    return service.handle(method, params, ctx, signal);
  });

  pi.on("agent_end", async (event, ctx) => {
    // Print/JSON sessions otherwise dispose their runtime immediately when the
    // model yields. Hold only that idle boundary (never spawn or the TUI loop)
    // until one result is ready, then queue it for Pi's post-run continuation.
    if (ctx.mode !== "print" && ctx.mode !== "json") return;
    const lastAssistant = [...event.messages].reverse().find((message) => message.role === "assistant");
    if (ctx.signal?.aborted || lastAssistant?.stopReason === "aborted" || lastAssistant?.stopReason === "error") return;
    const tasks = manager;
    const running = tasks?.list().filter((task) => task.status === "running") ?? [];
    if (tasks && running.length > 0) {
      let onAbort: (() => void) | undefined;
      try {
        await Promise.race([
          ...running.map((task) => tasks.wait(task.id)),
          new Promise<void>((resolve) => {
            onAbort = resolve;
            ctx.signal?.addEventListener("abort", onAbort, { once: true });
            if (ctx.signal?.aborted) resolve();
          }),
        ]);
      } finally {
        if (onAbort) ctx.signal?.removeEventListener("abort", onAbort);
      }
    }
    if (!ctx.signal?.aborted) completions.flush();
  });

  pi.on("before_agent_start", (event, ctx) => {
    // Some SDK embedders emit session_start before resumed entries are attached.
    // Rehydrate at the definitive ordinary-turn seam as well.
    restoreAgentIdentity(ctx);
    instructionMode.refresh(ctx);
    // session_start may precede dynamically loaded extension handlers in SDK
    // embedders; framing the first ordinary turn is the definitive scope seam.
    scopeInstructionContinuity(ctx.sessionManager as object);
    // Explicit user system prompts retain their existing override semantics.
    const custom = !!event.systemPromptOptions?.customPrompt;
    const base = custom ? event.systemPrompt : productSystemPrompt(event.systemPrompt);
    const values = custom ? "" : collaborationGuidance();
    const role = subagentDepth > 0 ? subagentGuidance(agentType ?? "normal", canSpawnSubagent) : instructionMode.guidance(ctx, custom);
    const additions = [values, role].filter(Boolean).join("\n\n");
    if (additions) return { systemPrompt: base + "\n\n" + additions };
  });

  pi.on("session_start", (_event, ctx) => {
    scopeInstructionContinuity(ctx.sessionManager as object);
    // A resumed child keeps identity and delegation restrictions even when
    // launched from /resume without the original process environment.
    restoreAgentIdentity(ctx);
    pi.setActiveTools(["execute"]);
    installUI(ctx);
    instructionMode.sessionStart(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    // Pi emits this before reload/new/resume/fork as well as final quit.
    clearInstructionContinuity(ctx.sessionManager as object);
    taskUi?.setStatus("die-tasks", undefined);
    instructionMode.shutdown();
    completions.dispose();
    await manager?.shutdown();
    manager = undefined;
    service = undefined;
  });
}
