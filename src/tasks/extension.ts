import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { CompletionBatcher } from "./completion-batcher";
import { formatCompletionNotification } from "./completion-notification";
import { TaskManager, type TaskInspection } from "./task-manager";
import { boundedMiddlePreview } from "./text-preview";

const TaskAction = StringEnum(["spawn", "list", "inspect", "input", "kill"] as const);
const ThinkingLevel = StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const);
const DEFAULT_LIST_COUNT = 50;
const MAX_LIST_COUNT = 100;
const MAX_LIST_COMMAND_CHARS = 500;

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

function formatInspection(task: TaskInspection): string {
  const lines = [
    `${task.id} ${task.status}${task.pid ? ` pid=${task.pid}` : ""}`,
    `kind=${task.kind} command=${task.command}`,
    `output cursor ${task.nextOffset}/${task.outputEnd}${task.outputLost ? " (earlier output discarded)" : ""}${task.hasMore ? " (more available)" : ""}`,
  ];
  if (task.output) lines.push("", task.output);
  return lines.join("\n");
}

export default function asynchronousTasksExtension(pi: ExtensionAPI): void {
  const subagentDepth = Math.max(0, Number.parseInt(process.env.DIE_SUBAGENT_DEPTH ?? "0", 10) || 0);
  const isSubagent = subagentDepth > 0;
  let manager: TaskManager | undefined;
  const completions = new CompletionBatcher<TaskInspection>((tasks) => {
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
      "Manage asynchronous tasks. Spawn returns immediately. Provide command for one command task or commands for multiple separate concurrent command tasks in one call. Sub-agents are spawned with the subagent tool and then managed here by ID. Use list or inspect while tasks run, input to write stdin, and kill to stop one. Completions are delivered automatically and burst completions are batched. List results are paginated with cursor/count. Inspection output is capped at 50,000 bytes per call and can be continued with the returned offset.",
    promptSnippet: "Spawn, inspect, interact with, and stop asynchronous commands or sub-agents",
    promptGuidelines: [
      "Use task instead of bash for command execution.",
      "Use task spawn with commands when starting multiple independent commands; each array entry becomes a separately managed concurrent task.",
      "After spawning with task, continue other useful work; task completion is reported automatically.",
      "Do not use task list or inspect merely to check whether a task completed, and never spawn sleep or wait commands solely to wait for another task.",
      "Use task inspect only when incremental output is needed for an interactive decision, and task input for interactive standard input.",
    ],
    parameters: TaskParameters,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
          return {
            content: [{
              type: "text",
              text: spawned.length === 1
                ? `Spawned ${spawned[0].id} (${spawned[0].kind}) pid=${spawned[0].pid ?? "unknown"}. Completion will be reported automatically.`
                : `Spawned ${spawned.length} concurrent tasks:\n${spawned.map((task) => `${task.id}\tpid=${task.pid ?? "unknown"}`).join("\n")}\nCompletions will be reported automatically.`,
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
                ...page.map((task) => `${task.id}\t${task.status}\t${task.kind}\t${boundedMiddlePreview(task.command, MAX_LIST_COMMAND_CHARS)}`),
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
      "Delegate work to one or more isolated background die agents. Returns task IDs immediately; each sub-agent is managed by the task system, so use task list, inspect, or kill with those IDs. Omit model and thinking to inherit the parent agent's current configuration. Multiple prompts can be started concurrently. Completion is reported automatically.",
    promptSnippet: "Delegate independent work to asynchronous agents with isolated context",
    promptGuidelines: [
      "Use subagent for independent research, review, planning, or implementation that benefits from an isolated context.",
      "After subagent returns task IDs, continue useful parent-agent work; do not poll because completion is reported automatically.",
      "Manage a spawned sub-agent with task inspect or task kill using its task ID.",
    ],
    parameters: SubagentParameters,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (isSubagent) throw new Error("Sub-agents cannot spawn other sub-agents");
      const prompts = params.prompts ?? (params.prompt?.trim() ? [params.prompt] : []);
      if (prompts.length === 0) throw new Error("subagent requires prompt or prompts");
      if (params.prompts && params.prompt) throw new Error("subagent accepts prompt or prompts, not both");
      const inheritedModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      const model = params.model?.trim() || inheritedModel;
      if (!model) throw new Error("No model is available for the sub-agent");
      const thinking = params.thinking ?? ctx.thinkingLevel;
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
        return getManager().spawn({
          kind: "agent",
          command: process.execPath,
          args: childArgs,
          displayCommand: `die sub-agent: ${prompt}`,
          cwd: ctx.cwd,
          env: { ...process.env, DIE_SUBAGENT_DEPTH: String(subagentDepth + 1) },
          timeoutMs: params.timeoutSeconds ? params.timeoutSeconds * 1000 : undefined,
          closeStdin: true,
        });
      });
      return {
        content: [{
          type: "text",
          text: spawned.length === 1
            ? `Spawned sub-agent ${spawned[0].id} pid=${spawned[0].pid ?? "unknown"}. Completion will be reported automatically.`
            : `Spawned ${spawned.length} concurrent sub-agents:\n${spawned.map((task) => `${task.id}\tpid=${task.pid ?? "unknown"}`).join("\n")}\nCompletions will be reported automatically.`,
        }],
        details: { tasks: spawned },
      };
    },
  });

  pi.on("session_start", () => {
    const active = pi
      .getActiveTools()
      .filter((name) => name !== "bash" && name !== "powershell" && (!isSubagent || name !== "subagent"));
    pi.setActiveTools([...new Set([...active, "task", ...(!isSubagent ? ["subagent"] : [])])]);
  });

  pi.on("session_shutdown", () => {
    completions.dispose();
    manager?.shutdown();
    manager = undefined;
  });
}
