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
import { registerCacheAffineCompaction } from "./cache-affine-compaction";
import { clearInstructionContinuity, scopeInstructionContinuity } from "./instruction-continuity";
import { registerNativeCodexCompaction } from "./native-compaction";
import { registerTaskMonitor } from "./task-monitor";
import { registerResumeSafeguards } from "./resume-safeguards";
import { registerInstructionMode } from "./instruction-mode";
import { CacheCountdown, registerCacheCountdown } from "./cache-countdown";
import {
  JobAttentionScheduler,
  formatAttentionNotification,
  type AttentionNotice,
  type AttentionOptions,
} from "./job-attention";
import { registerGoalMode, type GoalRuntime } from "../goals/extension";
import { registerNativeFastMode } from "./native-fast-mode";
import { registerManualShake } from "./manual-shake";

export function completionDiagnosticDetails(tasks: TaskInspection[], notices: AttentionNotice[]) {
  const taskStatusCounts = { completed: 0, failed: 0, killed: 0, running: 0, unknown: 0 };
  for (const task of tasks) {
    switch (task.status) {
      case "completed":
      case "failed":
      case "killed":
      case "running":
        taskStatusCounts[task.status]++;
        break;
      default:
        taskStatusCounts.unknown++;
    }
  }
  return {
    tasks: tasks
      .slice(0, 50)
      .map(({ output: _output, command, ...summary }) => ({ ...summary, command: command.slice(0, 400) })),
    attention: notices.slice(0, 50).map(({ task: _task, ...notice }) => notice),
    taskStatusCounts,
    taskCount: tasks.length,
    attentionCount: notices.length,
    omittedTasks: Math.max(0, tasks.length - 50),
    omittedAttention: Math.max(0, notices.length - 50),
  };
}

export default function asynchronousTasksExtension(
  pi: ExtensionAPI,
  options: {
    profilesPath?: string;
    cacheSettingsPath?: string;
    attention?: AttentionOptions;
    executablePath?: string;
  } = {},
): void {
  // Must precede all payload capture/observation hooks so snapshots contain the
  // exact tier that the provider transport will serialize.
  registerNativeFastMode(pi);
  const cacheCountdown = new CacheCountdown();
  registerCacheCountdown(pi, cacheCountdown, options.cacheSettingsPath);
  const installUI = createCompactUI(pi, cacheCountdown);
  pi.registerMessageRenderer("task-complete", (message, options, theme) =>
    completionPreview(message.content, options.expanded, theme, options.outputPad, "task-complete", message.details),
  );
  pi.registerMessageRenderer("task-attention", (message, options, theme) =>
    completionPreview(message.content, options.expanded, theme, options.outputPad, "task-attention", message.details),
  );
  registerSubagentSettings(pi, options.profilesPath);
  // Environment identity is the floor for genuinely spawned child processes.
  // A root process may switch among root and child sessions in the same closure.
  const environmentDepth = Math.max(0, Number.parseInt(process.env.DIE_SUBAGENT_DEPTH ?? "0", 10) || 0);
  const rawEnvironmentType = process.env.DIE_SUBAGENT_TYPE;
  const environmentType = SUBAGENT_TYPES.includes(rawEnvironmentType as (typeof SUBAGENT_TYPES)[number])
    ? rawEnvironmentType
    : undefined;
  let subagentDepth = environmentDepth;
  let agentType = environmentType;
  let canSpawnSubagent = canDelegate(subagentDepth, agentType);
  const instructionMode = registerInstructionMode(pi, () => subagentDepth === 0);
  const restoreAgentIdentity = (ctx: ExtensionContext) => {
    const sessionManager = ctx.sessionManager as { getBranch?: () => any[]; getEntries?: () => any[] } | undefined;
    const entries = sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
    const entry = entries.find((entry) => entry.type === "custom" && entry.customType === "die-agent");
    const data = entry?.type === "custom" ? (entry.data as { type?: string; depth?: number } | undefined) : undefined;
    const validChild =
      data &&
      SUBAGENT_TYPES.includes(data.type as (typeof SUBAGENT_TYPES)[number]) &&
      Number.isInteger(data.depth) &&
      data.depth! >= 1;
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
  let attention: JobAttentionScheduler | undefined;
  let invalidateShakeSnapshots = () => {};
  registerManualShake(pi, () => invalidateShakeSnapshots());
  const nativeCompaction = registerNativeCodexCompaction(
    pi,
    () =>
      manager
        ?.list()
        .filter((task) => task.status === "running")
        .map(({ id, kind, status }) => ({ id, kind, status })) ?? [],
  );
  invalidateShakeSnapshots = () => {
    nativeCompaction.invalidateCapture();
    cacheCountdown.invalidate();
  };
  registerCacheAffineCompaction(
    pi,
    () =>
      manager
        ?.list()
        .filter((task) => task.status === "running")
        .map(({ id, kind, status }) => ({ id, kind, status })) ?? [],
    { skipCodexNative: () => nativeCompaction.hasFreshCapture() },
  );
  let taskUi: ExtensionContext["ui"] | undefined;
  const updateTaskStatus = () => {
    const running = manager?.list().filter((task) => task.status === "running").length ?? 0;
    taskUi?.setStatus("die-tasks", running > 0 ? `${running} task${running === 1 ? "" : "s"} running` : undefined);
  };

  type Notification = { kind: "completion"; task: TaskInspection } | { kind: "attention"; notice: AttentionNotice };
  const notificationBatch = new CompletionBatcher<Notification>(
    (items) => {
      updateTaskStatus();
      const completionMap = new Map(
        items.filter((item) => item.kind === "completion").map((item) => [item.task.id, item.task]),
      );
      const runningIds = new Set(manager?.pending().map((task) => task.id) ?? []);
      const attentionMap = new Map(
        items
          .filter((item) => item.kind === "attention")
          .filter((item) => runningIds.has(item.notice.id) && !completionMap.has(item.notice.id))
          .map((item) => [item.notice.id, item.notice]),
      );
      const tasks = [...completionMap.values()],
        notices = [...attentionMap.values()];
      if (!tasks.length && !notices.length) return;
      const mixed = tasks.length > 0 && notices.length > 0;
      const separator = mixed ? 2 : 0;
      const completionBudget = mixed ? 2_499 : 5_000;
      const attentionBudget = mixed ? 5_000 - separator - completionBudget : 5_000;
      const content = [
        tasks.length ? formatCompletionNotification(tasks, completionBudget) : "",
        notices.length ? formatAttentionNotification(notices, attentionBudget) : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      pi.sendMessage(
        {
          customType: tasks.length ? "task-complete" : "task-attention",
          content,
          display: true,
          details: completionDiagnosticDetails(tasks, notices),
        },
        { deliverAs: "steer", triggerTurn: true },
      );
    },
    250,
    500,
  );
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

  let goals: GoalRuntime;
  const getManager = () => {
    if (!manager) {
      manager = new TaskManager((task) => {
        completions.add(task);
        goals.jobsChanged();
      });
      attention = new JobAttentionScheduler(
        manager,
        (notices) => {
          for (const notice of notices) attentions.add(notice);
        },
        options.attention,
      );
    }
    return manager;
  };

  registerTaskMonitor(pi, getManager);
  registerResumeSafeguards(pi);

  goals = registerGoalMode(pi, {
    runningIds: () =>
      new Set(
        manager
          ?.list()
          .filter((task) => task.status === "running")
          .map((task) => task.id) ?? [],
      ),
    status: (id) => {
      const task = manager?.list().find((item) => item.id === id);
      if (!task) return "unavailable";
      return task.status === "running" ? "running" : "finished";
    },
  });
  let service: JobService | undefined;
  registerExecuteTool(
    pi,
    (ctx, method, params, signal) => {
      if (method.startsWith("goal.")) return Promise.resolve(goals.handle(method, params));
      taskUi = ctx.ui;
      const tasks = getManager();
      service ??= new JobService(
        tasks,
        () => ({ depth: subagentDepth, type: agentType }),
        updateTaskStatus,
        options.profilesPath,
        attention,
      );
      return service.handle(method, params, ctx, signal);
    },
    options.executablePath,
  );

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
      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });
      // One manager listener covers every running job and, unlike Promise.then,
      // can be detached when attention or cancellation wins this boundary.
      const unsubscribe = tasks.subscribe((event) => {
        if (event.type === "completed") resolveCompletion();
      });
      const attentionWait = new AbortController();
      try {
        // A child can exit after the running snapshot but before subscription.
        // Rechecking after subscribing closes that gap without per-job waits.
        const current = new Map(tasks.list().map((task) => [task.id, task.status]));
        if (running.some((task) => current.get(task.id) !== "running")) resolveCompletion();
        boundary = await Promise.race([
          completion.then(() => "completion" as const),
          ...(attention
            ? [
                attention
                  .waitForNotice(
                    ctx.signal ? AbortSignal.any([ctx.signal, attentionWait.signal]) : attentionWait.signal,
                  )
                  .then(() => "attention" as const),
              ]
            : []),
          new Promise<"abort">((resolve) => {
            onAbort = () => resolve("abort");
            ctx.signal?.addEventListener("abort", onAbort, { once: true });
            if (ctx.signal?.aborted) resolve("abort");
          }),
        ]);
      } finally {
        unsubscribe();
        attentionWait.abort();
        if (onAbort) ctx.signal?.removeEventListener("abort", onAbort);
      }
    }
    // Keep the print boundary until the shared batch is actually delivered.
    // For attention, retain the normal short coalescing window so a completion
    // racing the checkpoint supersedes stale attention in one parent wakeup.
    if (!ctx.signal?.aborted) {
      if (boundary === "attention" && tasks) {
        // Give a task already racing the checkpoint one bounded chance to
        // complete; its completion supersedes stale attention for that task.
        // A single disposable listener avoids retaining one wait handler per
        // running task throughout repeated attention boundaries.
        const ids = new Set(running.map((task) => task.id));
        await new Promise<void>((resolve) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let unsubscribe = () => {};
          const finish = () => {
            if (settled) return;
            settled = true;
            unsubscribe();
            if (timer) clearTimeout(timer);
            ctx.signal?.removeEventListener("abort", finish);
            resolve();
          };
          unsubscribe = tasks.subscribe((event) => {
            if (event.type === "completed" && ids.has(event.task.id)) finish();
          });
          ctx.signal?.addEventListener("abort", finish, { once: true });
          timer = setTimeout(finish, 200);
          timer.unref?.();
          // Close the completion-before-subscription race.
          const current = new Map(tasks.list().map((task) => [task.id, task.status]));
          if ([...ids].some((id) => current.get(id) !== "running") || ctx.signal?.aborted) finish();
        });
      }
      notificationBatch.flush();
    }
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
    const role =
      subagentDepth > 0
        ? subagentGuidance(agentType ?? "normal", canSpawnSubagent)
        : instructionMode.guidance(ctx, custom);
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
    attentions.dispose();
    attention?.dispose();
    await manager?.shutdown();
    manager = undefined;
    attention = undefined;
    service = undefined;
  });
}
