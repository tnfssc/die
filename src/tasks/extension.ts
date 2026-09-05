import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { CompletionBatcher } from "./completion-batcher";
import { formatCompletionNotification } from "./completion-notification";
import { TaskManager, type TaskInspection } from "./task-manager";
import { boundedMiddlePreview } from "./text-preview";
import { registerExecuteTool } from "../typescript/extension";

const TaskAction = StringEnum(["spawn", "list", "inspect", "input", "kill"] as const);
const ThinkingLevel = StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const);
const DEFAULT_LIST_COUNT = 50;
const MAX_LIST_COUNT = 100;
const MAX_LIST_COMMAND_CHARS = 72;
const MAX_SUBAGENT_DEPTH = 2;
const PENDING_WORK_GUIDANCE = "If no useful independent work remains, acknowledge pending work once and end your turn without more tool calls. Ending the turn does not cancel background work; automatic completion will resume you. Do not claim dependent results yet.";

const TaskParameters = Type.Object({
  action: TaskAction,
  command: Type.Optional(Type.String({ description: "One shell command to run as a command task" })),
  commands: Type.Optional(Type.Array(Type.String(), { minItems: 1, description: "Shell commands to spawn as separate concurrent tasks in one call" })),

  id: Type.Optional(Type.String({ description: "Task ID for inspect, input, or kill" })),
  data: Type.Optional(Type.String({ description: "Data to write to the task's standard input" })),
  closeInput: Type.Optional(Type.Boolean({ description: "Close standard input after writing" })),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: "Output cursor returned by a previous inspection" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50_000 })),
  cursor: Type.Optional(Type.Integer({ minimum: 0, description: "Task index returned by a previous list page" })),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIST_COUNT, description: "Maximum tasks in a list page; defaults to 50" })),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0.1, maximum: 86_400 })),
});

const SubagentParameters = Type.Object({
  prompt: Type.Optional(Type.String({ description: "Task delegated to one isolated background agent" })),
  prompts: Type.Optional(Type.Array(Type.String(), { minItems: 1, description: "Tasks delegated to separate concurrent background agents" })),
  model: Type.Optional(Type.String({ description: "Optional model ID or provider/model ID; defaults to the parent model" })),
  thinking: Type.Optional(ThinkingLevel),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0.1, maximum: 86_400 })),
});

function elapsed(task: { startedAt: string; completedAt?: string }): string {
  const milliseconds = Math.max(0, Date.parse(task.completedAt ?? new Date().toISOString()) - Date.parse(task.startedAt));
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function formatInspection(task: TaskInspection): string {
  const lines = [
    `${task.id} ${task.status}${task.pid ? ` pid=${task.pid}` : ""} elapsed=${elapsed(task)}`,
    `kind=${task.kind} command=${boundedMiddlePreview(task.command, 160)}`,
    `output cursor ${task.nextOffset}/${task.outputEnd}${task.outputLost ? " (earlier output discarded)" : ""}${task.hasMore ? " (more available)" : ""}`,
  ];
  if (task.output) lines.push("", task.output);
  return lines.join("\n");
}

export default function asynchronousTasksExtension(pi: ExtensionAPI): void {
  const subagentDepth = Math.max(0, Number.parseInt(process.env.DIE_SUBAGENT_DEPTH ?? "0", 10) || 0);
  const canSpawnSubagent = subagentDepth < MAX_SUBAGENT_DEPTH;
  let manager: TaskManager | undefined;
  let taskUi: ExtensionContext["ui"] | undefined;
  const updateTaskStatus = () => {
    const running = manager?.list().filter((task) => task.status === "running").length ?? 0;
    taskUi?.setStatus("die-tasks", running > 0 ? `${running} task${running === 1 ? "" : "s"} running` : undefined);
  };
  registerExecuteTool(pi);
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

  pi.registerTool({
    name: "task",
    label: "Task",
    description:
      "Manage asynchronous tasks. Every call requires action: spawn, list, inspect, input, or kill. To start a command, pass {action: 'spawn', command: '...'}; command alone is invalid. Spawn returns immediately. Provide command for one command task or commands for multiple separate concurrent command tasks in one call. Sub-agents are spawned with the subagent tool and then managed here by ID. Use list to discover task IDs, inspect for output needed for a decision, input to write stdin, and kill to stop one; do not list or inspect merely to wait. Completions are delivered automatically and burst completions are batched. List results are paginated with cursor/count. Inspection output is capped at 50,000 bytes per call and can be continued with the returned offset.",
    promptSnippet: "Spawn, inspect, interact with, and stop asynchronous commands or sub-agents",
    promptGuidelines: [
      "Every task call requires action. Start a command with {action: 'spawn', command: '...'}; use {action: 'spawn', commands: ['...', '...']} for a batch.",
      "Use task instead of bash for command execution.",
      "Use task spawn with commands when starting multiple independent commands; each array entry becomes a separately managed concurrent task.",
      "After spawning with task, continue other useful work; task completion is reported automatically.",
      `After task spawn: ${PENDING_WORK_GUIDANCE}`,
      "Never use execute to print waiting messages, perform no-op work, sleep, or otherwise keep a turn alive while task or subagent work is pending.",
      "Do not use task list or inspect merely to check whether a task completed, and never spawn sleep or wait commands solely to wait for another task.",
      "Use task inspect only when incremental output is needed for an interactive decision, and task input for interactive standard input.",
    ],
    parameters: TaskParameters,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      taskUi = ctx.ui;
      const tasks = getManager();
      switch (params.action) {
        case "spawn": {
          const commands = params.commands ?? (params.command?.trim() ? [params.command] : []);
          if (commands.length === 0) throw new Error("spawn requires command or commands");
          if (params.commands && params.command) throw new Error("spawn accepts command or commands, not both");
          const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : process.env.SHELL ?? "/bin/sh";
          const spawned = commands.map((command) => {
            const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
            return tasks.spawn({
              kind: "command",
              command: shell,
              args: shellArgs,
              displayCommand: command,
              cwd: ctx.cwd,
              env: process.env,
              timeoutMs: params.timeoutSeconds ? params.timeoutSeconds * 1000 : undefined,
            });
          });
          updateTaskStatus();
          return {
            content: [{
              type: "text",
              text: spawned.length === 1
                ? `Spawned ${spawned[0].id} (${spawned[0].kind}) pid=${spawned[0].pid ?? "unknown"}. Completion will be reported automatically. ${PENDING_WORK_GUIDANCE}`
                : `Spawned ${spawned.length} concurrent tasks:\n${spawned.map((task) => `${task.id}\tpid=${task.pid ?? "unknown"}`).join("\n")}\nCompletions will be reported automatically. ${PENDING_WORK_GUIDANCE}`,
            }],
            details: { tasks: spawned },
          };
        }

        case "list": {
          const all = tasks.list();
          const cursor = Math.min(params.cursor ?? 0, all.length);
          const count = params.count ?? DEFAULT_LIST_COUNT;
          const page = all.slice(cursor, cursor + count);
          const nextCursor = cursor + page.length < all.length ? cursor + page.length : undefined;
          const text = page.length
            ? [
                `Tasks ${cursor + 1}-${cursor + page.length} of ${all.length}${nextCursor !== undefined ? `; next cursor=${nextCursor}` : ""}`,
                ...page.map((task) => `${task.id}\t${task.status} ${elapsed(task)}\t${task.kind}\t${boundedMiddlePreview(task.command, MAX_LIST_COMMAND_CHARS)}`),
              ].join("\n")
            : all.length === 0
              ? "No tasks have been spawned in this session."
              : `No tasks at cursor ${cursor}; total=${all.length}.`;
          return { content: [{ type: "text", text }], details: { tasks: page, total: all.length, cursor, nextCursor } };
        }

        case "inspect": {
          if (!params.id) throw new Error("inspect requires id");
          const task = tasks.inspect(params.id, params.offset, params.limit);
          return { content: [{ type: "text", text: formatInspection(task) }], details: task };
        }

        case "input": {
          if (!params.id) throw new Error("input requires id");
          if (params.data === undefined && !params.closeInput) throw new Error("input requires data or closeInput=true");
          const task = params.data !== undefined
            ? await tasks.write(params.id, params.data, params.closeInput)
            : tasks.closeInput(params.id);
          return { content: [{ type: "text", text: `Sent input to ${task.id}${params.closeInput ? " and closed stdin" : ""}.` }], details: task };
        }

        case "kill": {
          if (!params.id) throw new Error("kill requires id");
          const task = tasks.kill(params.id);
          return { content: [{ type: "text", text: `Termination requested for ${task.id}.` }], details: task };
        }
      }
    },
  });

  pi.registerTool({
    name: "subagent",
    label: "Sub-agent",
    description:
      subagentDepth === 0
        ? "Delegate work to one or more isolated background die agents, with at most two delegation levels below the root agent. Returns task IDs immediately; each sub-agent is managed by the task system, so use task list, inspect, or kill with those IDs. Omit model and thinking to inherit the parent agent's current configuration. Multiple prompts can be started concurrently. Completion is reported automatically."
        : "Delegate work to second-level isolated die agents. Nested delegation waits inside this tool call so the second-level results are returned before this first-level agent can exit. Multiple prompts run concurrently. Omit model and thinking to inherit the current configuration.",
    promptSnippet: "Delegate independent work to asynchronous agents with isolated context",
    promptGuidelines: subagentDepth === 0
      ? [
          "Use subagent for independent research, review, planning, or implementation that benefits from an isolated context.",
          "After subagent returns task IDs, continue useful parent-agent work; do not poll because completion is reported automatically.",
          `After subagent returns task IDs: ${PENDING_WORK_GUIDANCE}`,
          "Manage a spawned sub-agent with task inspect or task kill using its task ID.",
        ]
      : [
          "Use subagent to delegate independent work to the second and final sub-agent level.",
          "The call returns only after the nested work finishes; use the returned output directly and do not poll.",
        ],
    parameters: SubagentParameters,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      taskUi = ctx.ui;
      if (!canSpawnSubagent) throw new Error(`Sub-agent delegation is limited to ${MAX_SUBAGENT_DEPTH} levels`);
      const prompts = params.prompts ?? (params.prompt?.trim() ? [params.prompt] : []);
      if (prompts.length === 0) throw new Error("subagent requires prompt or prompts");
      if (params.prompts && params.prompt) throw new Error("subagent accepts prompt or prompts, not both");
      const inheritedModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      const model = params.model?.trim() || inheritedModel;
      if (!model) throw new Error("No model is available for the sub-agent");
      const thinking = params.thinking ?? ctx.thinkingLevel;
      const tasks = getManager();
      const spawned = prompts.map((prompt) => {
        const childArgs = [
          "--no-session",
          "-p",
          "--model",
          model,
          ...(thinking ? ["--thinking", thinking] : []),
          "--",
          prompt,
        ];
        return tasks.spawn({
          kind: "agent",
          command: process.execPath,
          args: childArgs,
          displayCommand: `die sub-agent: ${prompt}`,
          cwd: ctx.cwd,
          env: { ...process.env, DIE_SUBAGENT_DEPTH: String(subagentDepth + 1) },
          timeoutMs: params.timeoutSeconds ? params.timeoutSeconds * 1000 : undefined,
          closeStdin: true,
          notifyOnComplete: subagentDepth === 0,
        });
      });
      updateTaskStatus();

      if (subagentDepth > 0) {
        const completed = await Promise.all(spawned.map((task) => tasks.wait(task.id)));
        const text = completed
          .map((task) => [
            `${task.id} ${task.status}${task.exitCode !== undefined ? ` exit=${task.exitCode}` : ""}`,
            task.output || "No output.",
          ].join("\n"))
          .join("\n\n");
        return { content: [{ type: "text", text }], details: { tasks: completed } };
      }

      return {
        content: [{
          type: "text",
          text: spawned.length === 1
            ? `Spawned sub-agent ${spawned[0].id} pid=${spawned[0].pid ?? "unknown"}. Completion will be reported automatically. ${PENDING_WORK_GUIDANCE}`
            : `Spawned ${spawned.length} concurrent sub-agents:\n${spawned.map((task) => `${task.id}\tpid=${task.pid ?? "unknown"}`).join("\n")}\nCompletions will be reported automatically. ${PENDING_WORK_GUIDANCE}`,
        }],
        details: { tasks: spawned },
      };
    },
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

  pi.on("session_start", () => {
    pi.setActiveTools(["execute", "task", ...(canSpawnSubagent ? ["subagent"] : [])]);
  });

  pi.on("session_shutdown", async () => {
    taskUi?.setStatus("die-tasks", undefined);
    completions.dispose();
    await manager?.shutdown();
    manager = undefined;
  });
}
