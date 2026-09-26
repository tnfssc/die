import { questionService, type Question } from "../questions/service";
import { currentMainOwner, currentMainToolOwner } from "../live/main-owner";
import { requestForegroundStop } from "../tasks/foreground-stop";
import { SessionHost, type SessionTaskPort } from "../session/host";
import { registerSessionHost } from "../session/host-access";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { attachDiagnosticSink, diagnosticRecorder, recordDiagnostic } from "../diagnostics";
import { registerOperationDiagnostics } from "../diagnostics-extension";
import { type GoalRuntime, registerGoalMode } from "../goals/extension";
import { HistoryService } from "../history/service";
import { type ProjectWisdomRuntime, registerProjectWisdom } from "../wisdom/extension";
import { collaborationGuidance, isDieSystemPrompt, subagentGuidance } from "../prompts";
import { registerExecuteTool } from "../typescript/extension";
import { completionPreview } from "../ui/execution-previews";
import { createCompactUI } from "../ui/footer";
import { registerCacheAffineCompaction } from "./cache-affine-compaction";
import { CacheCountdown, registerCacheCountdown } from "./cache-countdown";
import { CompletionBatcher } from "../tasks/completion-batcher";
import { formatCompletionNotification } from "../tasks/completion-notification";
import { clearInstructionContinuity, scopeInstructionContinuity } from "./instruction-continuity";
import { registerInstructionMode } from "./instruction-mode";
import { registerLastUsedCliModel } from "./last-used-cli-model";
import {
  type AttentionNotice,
  type AttentionOptions,
  formatAttentionNotification,
  JobAttentionScheduler,
} from "../tasks/job-attention";
import { JobService } from "../tasks/job-service";
import { installLocalAgentTermination } from "../tasks/local-agent-termination";
import { registerManualShake } from "./manual-shake";
import { registerNativeCodexCompaction } from "./native-compaction";
import { registerNativeFastMode } from "./native-fast-mode";
import { registerResumeSafeguards } from "../tasks/resume-safeguards";
import { SUBAGENT_TYPES } from "../tasks/subagent-profiles";
import { registerSubagentSettings } from "../tasks/subagent-settings-ui";
import { T3LocalNotificationDelivery, T3LocalNotificationOutbox } from "../t3/tasks/local-notifications";
import { T3_MCP_BEARER_ENV, T3_MCP_URL_ENV } from "../delegation-environment";
import { t3BridgeEnvironment } from "../t3/tasks/mcp-client";
import { createTaskLifecycleRecorder } from "../tasks/task-lifecycle";
import { type TaskInspection, TaskManager } from "../tasks/task-manager";
import { registerTaskMonitor } from "../tasks/task-monitor";
import { createWebTaskEventEmitter } from "../t3/tasks/events";

export function completionDiagnosticDetails(tasks: TaskInspection[], notices: AttentionNotice[]) {
  const taskStatusCounts = {
    completed: 0,
    failed: 0,
    killed: 0,
    running: 0,
    unknown: 0,
  };
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
    tasks: tasks.slice(0, 50).map(({ output: _output, command, ...summary }) => ({
      ...summary,
      command: command.slice(0, 400),
    })),
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
  registerOperationDiagnostics(pi);
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
  const instructionMode = registerInstructionMode(pi, () => subagentDepth === 0);
  registerLastUsedCliModel(pi, () => subagentDepth === 0);
  let identityDiagnosticSession: object | undefined;
  let identityDiagnosticId: string | undefined;
  const restoreAgentIdentity = (ctx: ExtensionContext) => {
    type RestoredIdentity =
      | { kind: "absent" }
      | { kind: "invalid" }
      | { kind: "child"; type: (typeof SUBAGENT_TYPES)[number]; depth: number };
    // Begin fail-closed. Only a completely successful scan can establish that
    // the branch has no child marker and may therefore use root privileges.
    let identity: RestoredIdentity = { kind: "invalid" };
    try {
      const sessionManager = ctx.sessionManager as
        | { getBranch?: () => unknown; getEntries?: () => unknown }
        | undefined;
      const entries = sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
      if (!Array.isArray(entries)) throw new Error("Invalid session entries");

      let marker: Record<string, unknown> | undefined;
      for (let index = entries.length - 1; index >= 0; index--) {
        const candidate = entries[index];
        if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function"))
          throw new Error("Malformed session entry");
        // Access each possibly hostile property inside this guarded scan.
        const type = (candidate as Record<string, unknown>).type;
        const customType = (candidate as Record<string, unknown>).customType;
        if (type === "custom" && customType === "die-agent") {
          marker = candidate as Record<string, unknown>;
          break;
        }
      }

      if (!marker) {
        identity = { kind: "absent" };
      } else {
        const rawData = marker.data;
        if (!rawData || (typeof rawData !== "object" && typeof rawData !== "function"))
          throw new Error("Invalid child identity");
        const data = rawData as Record<string, unknown>;
        const type = data.type;
        const depth = data.depth;
        if (
          !SUBAGENT_TYPES.includes(type as (typeof SUBAGENT_TYPES)[number]) ||
          !Number.isInteger(depth) ||
          (depth as number) < 1
        )
          throw new Error("Invalid child identity");
        identity = {
          kind: "child",
          type: type as (typeof SUBAGENT_TYPES)[number],
          depth: depth as number,
        };
      }
    } catch {
      identity = { kind: "invalid" };
    }

    if (identity.kind === "child" && identity.depth >= environmentDepth) {
      // A spawned process may resume/fork deeper metadata, but its actual role
      // is a capability cap: session metadata cannot turn a leaf into an
      // orchestrator (or change an orchestrator into a different role). Root
      // processes intentionally remain free to traverse session identities.
      agentType = environmentDepth > 0 && environmentType ? environmentType : identity.type;
      subagentDepth = identity.depth;
    } else if (identity.kind === "invalid" || identity.kind === "child") {
      // Invalid or shallower metadata is never evidence of a root session.
      agentType = environmentType === "fast" ? "fast" : "normal";
      subagentDepth = Math.max(1, environmentDepth);
      try {
        const sessionId = ctx.sessionManager?.getSessionId?.();
        if (identityDiagnosticSession !== ctx.sessionManager || identityDiagnosticId !== sessionId) {
          identityDiagnosticSession = ctx.sessionManager;
          identityDiagnosticId = sessionId;
          recordDiagnostic(ctx.sessionManager as object, {
            component: "resume",
            code: "CHILD_IDENTITY_INVALID",
            outcome: "blocked",
            cancellation: "safety",
          });
        }
      } catch {
        // Hostile session metadata must not interrupt capability restriction.
      }
    } else {
      agentType = environmentType;
      subagentDepth = environmentDepth;
    }
  };
  let manager: TaskManager | undefined;
  let detachLocalTermination: (() => void) | undefined;
  let owningContext: ExtensionContext | undefined;
  let managerRecorder: ((input: Parameters<typeof recordDiagnostic>[1]) => void) | undefined;
  let detachManagerDiagnostics: (() => void) | undefined;
  let attention: JobAttentionScheduler | undefined;
  let invalidateShakeSnapshots = () => {};
  // Registration order is policy: shake previews first and a qualifying cancel
  // short-circuits native Codex and normal cache-affine compaction handlers.
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
    pi.events?.emit?.("herdr:tasks", { running });
    taskUi?.setStatus("die-tasks", running > 0 ? `${running} task${running === 1 ? "" : "s"} running` : undefined);
  };

  let t3NativeSession = false;
  let t3LocalDelivery: T3LocalNotificationDelivery | undefined;
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
      const owner = owningContext?.sessionManager && currentMainOwner(owningContext.sessionManager);
      if (owner) {
        owner.sendContext(content, {
          customType: tasks.length ? "task-complete" : "task-attention",
          details: completionDiagnosticDetails(tasks, notices),
        });
        return;
      }
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
    add: (task: TaskInspection) => {
      if (t3NativeSession && task.kind === "command") {
        if (!t3LocalDelivery) throw new Error("T3 local notification outbox is unavailable");
        t3LocalDelivery.enqueue({
          taskId: task.id,
          kind: "completion",
          text: formatCompletionNotification([task], 5_000),
        });
        return;
      }
      notificationBatch.add({ kind: "completion", task });
    },
    flush: () => notificationBatch.flush(),
    dispose: () => notificationBatch.dispose(),
  };
  const attentions = {
    add: (notice: AttentionNotice) => {
      if (t3NativeSession && notice.task.kind === "command") {
        if (!t3LocalDelivery) return; // fail closed: never create an unowned Pi turn
        t3LocalDelivery.enqueue({
          taskId: notice.id,
          kind: "attention",
          text: formatAttentionNotification([notice], 5_000),
        });
        return;
      }
      notificationBatch.add({ kind: "attention", notice });
    },
    flush: () => notificationBatch.flush(),
    // Completion owns the shared batcher's disposal.
    dispose: () => {},
  };

  let goals: GoalRuntime;
  let projectWisdom: ProjectWisdomRuntime | undefined;
  const reconcileProjectWisdom = () => {
    const runtime = projectWisdom;
    if (!runtime) return;
    // Completion can race both pending-record installation and an already-running
    // reconciliation. Recheck once its current pass drains so the terminal edge
    // cannot be absorbed by that in-flight promise.
    void runtime
      .jobsChanged()
      .then(() => runtime.jobsChanged())
      .catch(() => {
        // Reconciliation reports actionable failures through UI; never leak a
        // detached lifecycle promise as an unhandled rejection.
      });
  };
  const getManager = (ctx = owningContext) => {
    if (t3NativeSession && !t3LocalDelivery)
      throw new Error("T3 local jobs require an available durable notification outbox");
    if (!manager) {
      // Capture ownership at manager creation, never through a mutable active
      // context. SessionManager objects may themselves be reused on /resume.
      const owner = ctx?.sessionManager;
      const sessionId = owner?.getSessionId?.();
      // Generation capture prevents an old manager from writing after the same
      // SessionManager object is detached and reattached, even when its SID is
      // unchanged or unavailable.
      const recordForAttachment = owner ? diagnosticRecorder(owner) : undefined;
      const recordOwned = (input: Parameters<typeof recordDiagnostic>[1]) => {
        try {
          if (owner && owner.getSessionId?.() === sessionId) recordForAttachment?.(input);
        } catch {
          // Diagnostics remain best effort when manager metadata is hostile.
        }
      };
      managerRecorder = recordOwned;
      const lifecycle = createTaskLifecycleRecorder(owner?.getSessionFile?.(), (failure) =>
        recordOwned({
          component: "jobs",
          code:
            failure === "contention"
              ? "lifecycle_lock_contended"
              : failure === "locking"
                ? "lifecycle_lock_unavailable"
                : "JOBS_LIFECYCLE_WRITE_FAILED",
          outcome: "failed",
        }),
      );
      manager = new TaskManager(
        (task) => {
          completions.add(task);
          goals.jobsChanged();
        },
        undefined,
        {
          recordDiagnostic: (input) => {
            recordOwned(input);
            if (input.code === "JOBS_SHUTDOWN_CLOSURE_TIMEOUT") {
              for (const task of ownedManager.pending())
                lifecycle({
                  event: "closure-unobserved",
                  at: new Date().toISOString(),
                  taskId: task.id,
                  kind: task.kind,
                  status: task.status,
                  termination: task.termination,
                  sessionFile: task.agent?.sessionFile,
                });
            }
          },
        },
      );
      const ownedManager = manager;
      // Only the local CLI subagent receives a parent SIGTERM. Its own async
      // children live in detached groups, outside the parent group signal.
      if (subagentDepth > 0 && environmentDepth > 0 && !t3NativeSession) {
        detachLocalTermination = installLocalAgentTermination(process, ownedManager, (code) => process.exit(code));
      }
      detachManagerDiagnostics = attachDiagnosticSink(manager, (_type, data) =>
        recordOwned(data as Parameters<typeof recordDiagnostic>[1]),
      );
      const emitWebTask = createWebTaskEventEmitter(ctx?.mode);
      manager.subscribe((event) => {
        emitWebTask(event);
        if (event.type === "activity") return;
        if (event.type === "completed") reconcileProjectWisdom();
        const task = event.task;
        lifecycle({
          event: event.type,
          at: new Date().toISOString(),
          taskId: task.id,
          kind: task.kind,
          status: task.status,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          termination: task.termination,
          exitCode: task.exitCode,
          signal: task.signal,
          sessionFile: task.agent?.sessionFile,
        });
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
  const history = new HistoryService();
  let service: JobService | undefined;
  const getService = (ctx: ExtensionContext) => {
    taskUi = ctx.ui;
    owningContext = ctx;
    const tasks = getManager(ctx);
    // The service belongs to exactly one manager/session attachment. Shutdown
    // clears both, so a resumed or switched session cannot dispatch into stale state.
    if (!service || service.manager !== tasks)
      service = new JobService(
        tasks,
        () => ({ depth: subagentDepth, type: agentType }),
        updateTaskStatus,
        options.profilesPath,
        attention,
        managerRecorder,
        undefined,
        undefined,
        () => {
          if (t3NativeSession)
            t3LocalDelivery!.outbox.assertLaunchCapacity(
              tasks.list().filter((task) => task.status === "running").length,
            );
        },
      );
    return service;
  };
  let sessionHost: SessionHost | undefined;
  registerSessionHost(pi, (ctx) => {
    if (ctx.sessionManager !== owningContext?.sessionManager) return undefined;
    if (!sessionHost)
      sessionHost = new SessionHost({
        tasks: {
          list: (params, context, signal) => getService(context).handle("jobs.list", params, context, signal),
          inspect: (id, offset, context, signal) =>
            getService(context).handle(
              "jobs.inspect",
              { id, ...(offset === undefined ? {} : { offset }), limit: 3000 },
              context,
              signal,
            ),
          stop: (id, context, signal) => getService(context).handle("jobs.stop", { id }, context, signal),
          localJobs: () =>
            getManager(ctx)
              .list()
              .map(({ id, status, kind }) => ({ id, status, kind })),
          subscribe: (listener) => getManager(ctx).subscribe((event) => listener(event)),
        } satisfies SessionTaskPort,
        context: ctx,
        sendUserMessage: (text, options) => pi.sendUserMessage(text, options),
        confirmStop: (id) => ctx.ui.confirm("Stop job?", `Cancel job ${id}?`),
      });
    return sessionHost;
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const text = event.message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .slice(0, 2000);
    if (text) sessionHost?.observe({ type: "assistant", text });
  });
  pi.on("turn_end", () => {
    sessionHost?.observe({ type: "turn_end" });
  });
  projectWisdom = registerProjectWisdom(pi, {
    isRoot: () => subagentDepth === 0,
  });
  // The saved answer, not an execute socket or transcript guess, is the continuation authority.
  // Only this live parent process may start a new turn; answers survive restart for manual resume.
  const questionQueue: Array<{ question: Question; ctx: import("@earendil-works/pi-coding-agent").ExtensionContext }> =
    [];
  const deliverQuestions = () => {
    while (questionQueue.length) {
      const { question, ctx } = questionQueue[0]!;
      const manager = ctx.sessionManager;
      if (
        !manager ||
        manager.getSessionId() !== question.owner.sessionId ||
        !manager.getBranch().some((entry) => entry.id === question.owner.branchId)
      ) {
        questionQueue.shift(); // Saved answer remains readable; wrong branch must never receive it.
        continue;
      }
      if (!ctx.isIdle() || currentMainToolOwner(manager)) return;
      questionQueue.shift();
      pi.sendUserMessage(
        "Answer saved for question " +
          question.id +
          " (version " +
          question.version +
          "): " +
          question.answer +
          "\nContinue from this answered question on the current parent branch. Do not resume a native child in place.",
        { deliverAs: "followUp" },
      );
      return;
    }
  };
  if (subagentDepth === 0) {
    questionService.onAnswered = (question, ctx) => {
      questionQueue.push({ question, ctx: ctx as import("@earendil-works/pi-coding-agent").ExtensionContext });
      queueMicrotask(deliverQuestions);
    };
    pi.on("agent_end", () => {
      setTimeout(deliverQuestions, 0);
    });
  }
  const executeControl = registerExecuteTool(
    pi,
    async (ctx, method, params, signal) => {
      if (method.startsWith("history.")) return history.handle(method, params, ctx);
      if (method.startsWith("goal.")) return Promise.resolve(goals.handle(method, params));
      if (method.startsWith("questions.")) return questionService.handle(method, params, ctx);
      if ((method === "jobs.stop" || method === "jobs.stopWork") && sessionHost)
        await sessionHost.confirmDelegatedAgentStop(
          method === "jobs.stopWork"
            ? "current-session work"
            : params && typeof params === "object"
              ? (params as { id?: unknown }).id
              : undefined,
        );
      const result = await getService(ctx).handle(method, params, ctx, signal);
      if (method !== "jobs.stopWork") return result;
      // The helper result must reach execute before aborting that foreground.
      // Async jobs are already requested through the same scoped JobService.
      const voiceOwner = currentMainToolOwner(ctx.sessionManager);
      voiceOwner?.captureStopWorkReport?.(result);
      const foreground = requestForegroundStop(
        {
          sessionManager: ctx.sessionManager,
          isIdle: () => (voiceOwner ? false : ctx.isIdle()),
          abort: () => {
            if (voiceOwner) voiceOwner.stopForeground();
            else {
              executeControl.stopForeground(ctx);
              ctx.abort();
            }
          },
        },
        signal,
        (observed) =>
          sessionHost?.observe({ type: "stopping", text: "Foreground stop observation: " + JSON.stringify(observed) }),
        voiceOwner ? () => currentMainToolOwner(ctx.sessionManager) === voiceOwner : undefined,
      );
      sessionHost?.observe({
        type: "stopping",
        text: "Current-session stop-work result (not proof pending jobs exited): " + JSON.stringify(result),
      });
      return {
        ...(result as object),
        foreground,
        outcome:
          foreground.outcome === "error" || (result as { outcome: string }).outcome === "partial"
            ? "partial"
            : foreground.outcome === "pending"
              ? "pending"
              : (result as { outcome: string }).outcome,
      };
    },
    options.executablePath,
  );

  pi.on("agent_end", async (event, ctx) => {
    // Print/JSON sessions otherwise dispose their runtime immediately when the
    // model yields. Hold only that idle boundary (never spawn or the TUI loop)
    // until one result is ready, then queue it for Pi's post-run continuation.
    // RPC is persistent. Local CLI sessions retain the historical synchronous
    // flush, but T3 notifications never use Pi's volatile steer queue: they are
    // persisted at the completion edge and committed through the server.
    if (ctx.mode === "rpc") {
      // T3 delivery is already durable and server-dispatched. Flushing Pi's
      // volatile steer queue here cannot make a post-handoff completion safe.
      if (!t3NativeSession) notificationBatch.flush();
      return;
    }
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

  pi.on("input", async (event, ctx) => {
    const owner = currentMainOwner(ctx.sessionManager);
    if (!owner) return;
    if (event.source === "extension") return;
    if (event.images?.length) {
      ctx.ui.notify("Live typed input cannot forward images; try again without images.", "warning");
      return { action: "handled" };
    }
    try {
      await owner.typedInput(event.text);
    } catch {
      ctx.ui.notify("Live could not prepare this turn. Continue in text.", "warning");
    }
    return { action: "handled" };
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
    // Pi assembled Die's base with dynamic append/context/skill/cwd sections.
    // A user-owned custom base remains untouched at root, but children must
    // retain their role identity and delegation boundary on every base.
    const userCustom = custom && !isDieSystemPrompt(event.systemPromptOptions);
    if (userCustom && subagentDepth === 0) return;
    const role = subagentDepth > 0 ? subagentGuidance(agentType ?? "normal") : instructionMode.guidance(ctx, false);
    const additions = [userCustom ? "" : collaborationGuidance(), role].filter(Boolean).join("\n\n");
    if (additions) return { systemPrompt: event.systemPrompt + "\n\n" + additions };
  });

  pi.on("session_start", async (_event, ctx) => {
    notificationBatch.reset();
    await t3LocalDelivery?.stop();
    t3LocalDelivery = undefined;
    t3NativeSession = process.env[T3_MCP_URL_ENV] !== undefined || process.env[T3_MCP_BEARER_ENV] !== undefined;
    const sessionFile = ctx.sessionManager?.getSessionFile?.();
    if (sessionFile) {
      try {
        const bridge = t3BridgeEnvironment();
        if (bridge.kind === "remote") {
          t3NativeSession = true;
          t3LocalDelivery = new T3LocalNotificationDelivery(new T3LocalNotificationOutbox(sessionFile), bridge);
          t3LocalDelivery.start(); // replay commit-with-lost-ACK rows on resume
        }
      } catch {
        // A configured T3 session fails closed if its durable mailbox cannot be
        // opened. It must never fall back to an unowned Pi-triggered turn.
      }
    }
    owningContext = ctx;
    scopeInstructionContinuity(ctx.sessionManager as object);
    // A resumed child keeps identity and delegation restrictions even when
    // launched from /resume without the original process environment.
    restoreAgentIdentity(ctx);
    pi.setActiveTools(["execute"]);
    installUI(ctx);
    instructionMode.sessionStart(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    currentMainOwner(ctx.sessionManager)?.stopForeground();
    currentMainOwner(ctx.sessionManager)?.close();
    // Pi emits this before reload/new/resume/fork as well as final quit.
    sessionHost?.close();
    sessionHost = undefined;
    clearInstructionContinuity(ctx.sessionManager as object);
    taskUi?.setStatus("die-tasks", undefined);
    instructionMode.shutdown();
    await t3LocalDelivery?.stop();
    t3LocalDelivery = undefined;
    t3NativeSession = false;
    completions.dispose();
    attentions.dispose();
    attention?.dispose();
    await manager?.shutdown();
    detachLocalTermination?.();
    detachLocalTermination = undefined;
    detachManagerDiagnostics?.();
    detachManagerDiagnostics = undefined;
    managerRecorder = undefined;
    manager = undefined;
    attention = undefined;
    service = undefined;
    owningContext = undefined;
  });
}
