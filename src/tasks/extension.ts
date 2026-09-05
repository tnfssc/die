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
import { JobAttentionScheduler, formatAttentionNotification, type AttentionNotice, type AttentionOptions } from "./job-attention";

export default function asynchronousTasksExtension(pi: ExtensionAPI, options: { profilesPath?: string; attention?: AttentionOptions; executablePath?: string } = {}): void {
  const installUI = createCompactUI(pi);
  pi.registerMessageRenderer("task-complete", (message, options, theme) =>
    completionPreview(message.content, options.expanded, theme, options.outputPad));
  pi.registerMessageRenderer("task-attention", (message, options, theme) =>
    completionPreview(message.content, options.expanded, theme, options.outputPad));
  registerSubagentSettings(pi, options.profilesPath);
  let subagentDepth = Math.max(0, Number.parseInt(process.env.DIE_SUBAGENT_DEPTH ?? "0", 10) || 0);
  let agentType = process.env.DIE_SUBAGENT_TYPE;
  let canSpawnSubagent = canDelegate(subagentDepth, agentType);
  let manager: TaskManager | undefined;
  let attention: JobAttentionScheduler | undefined;
  registerNativeCodexCompaction(pi, () => manager?.list().filter(task => task.status === "running")
    .map(({id,kind,status}) => ({id,kind,status})) ?? []);
  registerCacheAffineCompaction(pi, () => manager?.list().filter(task => task.status === "running")
    .map(({id,kind,status}) => ({id,kind,status})) ?? [], { skipCodexNative: true });
  let taskUi: ExtensionContext["ui"] | undefined;
  const updateTaskStatus = () => {
    const running = manager?.list().filter((task) => task.status === "running").length ?? 0;
    taskUi?.setStatus("die-tasks", running > 0 ? `${running} task${running === 1 ? "" : "s"} running` : undefined);
  };

  type Notification = { kind: "completion"; task: TaskInspection } | { kind: "attention"; notice: AttentionNotice };
  const notificationBatch = new CompletionBatcher<Notification>((items) => {
    updateTaskStatus();
    const completionMap = new Map(items.filter(item => item.kind === "completion").map(item => [item.task.id, item.task]));
    const runningIds = new Set(manager?.pending().map(task => task.id) ?? []);
    const attentionMap = new Map(items.filter(item => item.kind === "attention")
      .filter(item => runningIds.has(item.notice.id) && !completionMap.has(item.notice.id))
      .map(item => [item.notice.id, item.notice]));
    const tasks = [...completionMap.values()], notices = [...attentionMap.values()];
    if (!tasks.length && !notices.length) return;
    const mixed = tasks.length > 0 && notices.length > 0;
    const separator = mixed ? 2 : 0;
    const completionBudget = mixed ? 2_499 : 5_000;
    const attentionBudget = mixed ? 5_000 - separator - completionBudget : 5_000;
    const content = [tasks.length ? formatCompletionNotification(tasks, completionBudget) : "",
      notices.length ? formatAttentionNotification(notices, attentionBudget) : ""].filter(Boolean).join("\n\n");
    pi.sendMessage({
      customType: tasks.length ? "task-complete" : "task-attention", content, display: true,
      details: {
        tasks: tasks.slice(0, 50).map(({ output: _output, command, ...summary }) => ({ ...summary, command: command.slice(0, 400) })),
        attention: notices.slice(0, 50).map(({ task: _task, ...notice }) => notice),
        omittedTasks: Math.max(0, tasks.length - 50),
        omittedAttention: Math.max(0, notices.length - 50),
      },
    }, { deliverAs: "steer", triggerTurn: true });
  });
  const completions = {
    add: (task: TaskInspection) => notificationBatch.add({ kind: "completion", task }),
    flush: () => notificationBatch.flush(),
    dispose: () => notificationBatch.dispose(),
  };
  const attentions = {
    add: (notice: AttentionNotice) => notificationBatch.add({ kind: "attention", notice }),
    flush: () => notificationBatch.flush(),
    // Completion owns the shared batcher's disposal.
    dispose: () => {},
  };

  const getManager = () => {
    if (!manager) {
      manager = new TaskManager((task) => completions.add(task));
      attention = new JobAttentionScheduler(manager, notices => { for (const notice of notices) attentions.add(notice); }, options.attention);
    }
    return manager;
  };

  let service: JobService | undefined;
  registerExecuteTool(pi, (ctx, method, params, signal) => {
    taskUi = ctx.ui;
    const tasks = getManager();
    service ??= new JobService(tasks, () => ({ depth: subagentDepth, type: agentType }), updateTaskStatus, options.profilesPath, attention);
    return service.handle(method, params, ctx, signal);
  }, options.executablePath);

  pi.on("agent_end", async (event, ctx) => {
    // Print/JSON sessions otherwise dispose their runtime immediately when the
    // model yields. Hold only that idle boundary (never spawn or the TUI loop)
    // until one result is ready, then queue it for Pi's post-run continuation.
    if (ctx.mode !== "print" && ctx.mode !== "json") return;
    const lastAssistant = [...event.messages].reverse().find((message) => message.role === "assistant");
    if (ctx.signal?.aborted || lastAssistant?.stopReason === "aborted" || lastAssistant?.stopReason === "error") return;
    const tasks = manager;
    const running = tasks?.list().filter((task) => task.status === "running") ?? [];
    let boundary: "completion" | "attention" | "abort" = "abort";
    if (tasks && running.length > 0) {
      let onAbort: (() => void) | undefined;
      const attentionWait = new AbortController();
      try {
        boundary = await Promise.race([
          ...running.map((task) => tasks.wait(task.id).then(() => "completion" as const)),
          ...(attention ? [attention.waitForNotice(ctx.signal ? AbortSignal.any([ctx.signal, attentionWait.signal]) : attentionWait.signal).then(() => "attention" as const)] : []),
          new Promise<"abort">((resolve) => {
            onAbort = () => resolve("abort");
            ctx.signal?.addEventListener("abort", onAbort, { once: true });
            if (ctx.signal?.aborted) resolve("abort");
          }),
        ]);
      } finally {
        attentionWait.abort();
        if (onAbort) ctx.signal?.removeEventListener("abort", onAbort);
      }
    }
    // Keep the print boundary until the shared batch is actually delivered.
    // For attention, retain the normal short coalescing window so a completion
    // racing the checkpoint supersedes stale attention in one parent wakeup.
    if (!ctx.signal?.aborted) {
      if (boundary === "attention") await new Promise(resolve => setTimeout(resolve, 100));
      notificationBatch.flush();
    }
  });

  pi.on("before_agent_start", (event, ctx) => {
    // session_start may precede dynamically loaded extension handlers in SDK
    // embedders; framing the first ordinary turn is the definitive scope seam.
    scopeInstructionContinuity(ctx.sessionManager as object);
    // Explicit user system prompts retain their existing override semantics.
    const custom = !!event.systemPromptOptions?.customPrompt;
    const base = custom ? event.systemPrompt : productSystemPrompt(event.systemPrompt);
    const values = custom ? "" : collaborationGuidance();
    const role = subagentDepth > 0 ? subagentGuidance(agentType ?? "normal", canSpawnSubagent) : "";
    const additions = [values, role].filter(Boolean).join("\n\n");
    if (additions) return { systemPrompt: base + "\n\n" + additions };
  });

  pi.on("session_start", (_event, ctx) => {
    scopeInstructionContinuity(ctx.sessionManager as object);
    // A resumed child must keep its identity and delegation restrictions even
    // when launched from /resume without the original process environment.
    const entry = ctx.sessionManager?.getEntries().find(entry => entry.type === "custom" && entry.customType === "die-agent");
    if (entry?.type === "custom") {
      const data = entry.data as { type?: string; depth?: number } | undefined;
      if (data && SUBAGENT_TYPES.includes(data.type as typeof SUBAGENT_TYPES[number]) && Number.isInteger(data.depth) && data.depth! >= 1) {
        agentType = data.type;
        subagentDepth = data.depth!;
        canSpawnSubagent = canDelegate(subagentDepth, agentType);
      }
    }
    pi.setActiveTools(["execute"]);
    installUI(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    // Pi emits this before reload/new/resume/fork as well as final quit.
    clearInstructionContinuity(ctx.sessionManager as object);
    taskUi?.setStatus("die-tasks", undefined);
    completions.dispose();
    attentions.dispose();
    attention?.dispose();
    await manager?.shutdown();
    manager = undefined;
    attention = undefined;
    service = undefined;
  });
}
