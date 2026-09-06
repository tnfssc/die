import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as z from "zod/mini";
import { prepareAgentSession } from "./agent-session";
import { type JobAttentionScheduler, MAX_SNOOZE_MINUTES } from "./job-attention";
import { sessionCostRoot } from "./session-cost-root";
import { canDelegate, loadProfiles, resolveProfile, SUBAGENT_TYPES } from "./subagent-profiles";
import type { TaskManager, TaskSummary } from "./task-manager";
import { boundedMiddlePreview } from "./text-preview";

const waitSeconds = z.optional(z.number().check(z.minimum(0), z.maximum(86400)));
const timeoutSeconds = z.optional(z.number().check(z.minimum(0.1), z.maximum(86400)));
const Shell = z.strictObject({
  command: z.string().check(z.minLength(1)),
  waitSeconds,
  timeoutSeconds,
  closeInput: z.optional(z.boolean()),
});
const Agent = z.strictObject({
  type: z.optional(z.enum(SUBAGENT_TYPES)),
  prompt: z.optional(z.string().check(z.minLength(1))),
  prompts: z.optional(z.array(z.string().check(z.minLength(1))).check(z.minLength(1))),
  waitSeconds,
  timeoutSeconds,
});
const List = z.strictObject({
  cursor: z.optional(z.int().check(z.minimum(0))),
  count: z.optional(z.int().check(z.minimum(1), z.maximum(100))),
});
const Inspect = z.strictObject({
  id: z.string(),
  offset: z.optional(z.int().check(z.minimum(0))),
  limit: z.optional(z.int().check(z.minimum(1), z.maximum(5000))),
});
const Input = z.strictObject({ id: z.string(), data: z.optional(z.string()), closeInput: z.optional(z.boolean()) });
const Id = z.strictObject({ id: z.string() });
const Snooze = z.strictObject({
  id: z.string(),
  minutes: z.number().check(z.minimum(Number.MIN_VALUE), z.maximum(MAX_SNOOZE_MINUTES)),
});
const Watch = z.strictObject({ id: z.string(), enabled: z.boolean() });
function flatten(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { options, ...rest } = value as Record<string, unknown>;
  if (options === undefined) return rest;
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("options must be an object");
  if (Object.keys(options).some((key) => key in rest)) throw new Error("Duplicate job option");
  return { ...options, ...rest };
}
function preview<T extends TaskSummary>(job: T): T {
  const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();
  return {
    ...job,
    command: boundedMiddlePreview(job.command, 160),
    elapsedMs: Math.max(0, end - Date.parse(job.startedAt)),
    ...(job.agent ? { quietForMs: Math.max(0, end - Date.parse(job.agent.lastActivityAt ?? job.startedAt)) } : {}),
  };
}
export interface JobDiagnosticInput {
  component: "jobs";
  code: "JOBS_OPERATION_DISPATCH";
  outcome: "success" | "failed" | "cancelled";
  operationId: string;
  taskId?: string;
  dispatch: "initiated" | "response";
  cancellation?: "caller";
  count?: number;
}
export type JobDiagnosticRecorder = (input: JobDiagnosticInput) => void;

export class JobService {
  #diagnosticFailureReported = false;
  #inspectionFailureReported = false;
  constructor(
    readonly manager: TaskManager,
    private policy: () => { depth: number; type?: string },
    private changed: () => void,
    private profilesPath?: string,
    private attention?: JobAttentionScheduler,
    private recordDiagnostic?: JobDiagnosticRecorder,
  ) {}
  async handle(method: string, value: unknown, ctx: ExtensionContext, signal: AbortSignal): Promise<unknown> {
    const operationId = randomUUID();
    const observational = method === "jobs.list" || method === "jobs.inspect";
    if (!observational)
      this.#record({
        component: "jobs",
        code: "JOBS_OPERATION_DISPATCH",
        outcome: "success",
        operationId,
        dispatch: "initiated",
      });
    try {
      const result = await this.#handle(method, value, ctx, signal);
      const records = Array.isArray(result) ? result : [result];
      const ids = records.flatMap((item) =>
        item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
          ? [(item as { id: string }).id]
          : [],
      );
      if (!observational)
        this.#record({
          component: "jobs",
          code: "JOBS_OPERATION_DISPATCH",
          outcome: "success",
          operationId,
          dispatch: "response",
          ...(ids.length === 1 ? { taskId: ids[0] } : {}),
          ...(records.length > 1 ? { count: records.length } : {}),
        });
      return result;
    } catch (error) {
      // Inspection is polling, not a stream of health events. Retain one
      // failure per service lifetime without consuming the durable budget.
      if (!observational || !this.#inspectionFailureReported)
        this.#record({
          component: "jobs",
          code: "JOBS_OPERATION_DISPATCH",
          outcome: signal.aborted ? "cancelled" : "failed",
          operationId,
          dispatch: "response",
          ...(signal.aborted ? { cancellation: "caller" as const } : {}),
        });
      if (observational) this.#inspectionFailureReported = true;
      throw error;
    }
  }

  async #handle(method: string, value: unknown, ctx: ExtensionContext, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const input = flatten(value ?? {});
    switch (method) {
      case "shell": {
        const params = z.parse(Shell, input);
        if (!params.command.trim()) throw new Error("shell requires a nonempty command");
        const executable =
          process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : (process.env.SHELL ?? "/bin/sh");
        const task = this.manager.spawn({
          kind: "command",
          command: executable,
          args: process.platform === "win32" ? ["/d", "/s", "/c", params.command] : ["-lc", params.command],
          displayCommand: params.command,
          cwd: ctx.cwd,
          closeStdin: params.closeInput,
          timeoutMs: params.timeoutSeconds ? params.timeoutSeconds * 1000 : undefined,
          notifyOnComplete: false,
        });
        this.changed();
        const result = await this.manager.foreground(task.id, (params.waitSeconds ?? 3) * 1000, signal);
        this.changed();
        return preview(result);
      }
      case "subagent": {
        const params = z.parse(Agent, input);
        const { depth, type: parentType } = this.policy();
        if (depth >= 2) throw new Error("Delegation is limited to two levels below the root");
        if (!canDelegate(depth, parentType)) throw new Error("Only orchestrator agents can delegate");
        const type = params.type ?? "normal";
        if (depth > 0 && type === "orchestrator")
          throw new Error("Spawned orchestrators may only delegate to fast/normal workers");
        if (params.prompt && params.prompts) throw new Error("Use prompt or prompts, not both");
        const prompts = params.prompts ?? (params.prompt ? [params.prompt] : []);
        if (!prompts.length || prompts.some((prompt) => !prompt.trim()))
          throw new Error("subagent requires nonempty prompt(s)");
        const { model, thinking } = resolveProfile(await loadProfiles(this.profilesPath), type, {
          model: ctx.model ? ctx.model.provider + "/" + ctx.model.id : undefined,
          thinking: ctx.thinkingLevel,
        });
        const spawned: TaskSummary[] = [];
        try {
          for (const prompt of prompts) {
            signal.throwIfAborted();
            const prepared = await prepareAgentSession(ctx.cwd, ctx.sessionManager?.getSessionDir(), {
              type,
              model,
              thinking,
              depth: depth + 1,
              parentSessionFile: ctx.sessionManager ? sessionCostRoot(ctx.sessionManager)?.file : undefined,
            });
            signal.throwIfAborted();
            spawned.push(
              this.manager.spawn({
                ...prepared,
                kind: "agent",
                command: process.execPath,
                args: [
                  "--session",
                  prepared.agent.sessionFile,
                  "--mode",
                  "json",
                  "-p",
                  "--model",
                  model,
                  ...(thinking ? ["--thinking", thinking] : []),
                  "--",
                  prompt,
                ],
                displayCommand: "die agent [" + type + "]: " + prompt,
                cwd: ctx.cwd,
                env: { ...process.env, DIE_SUBAGENT_DEPTH: String(depth + 1), DIE_SUBAGENT_TYPE: type },
                timeoutMs: params.timeoutSeconds ? params.timeoutSeconds * 1000 : undefined,
                closeStdin: true,
                notifyOnComplete: false,
              }),
            );
          }
        } catch (error) {
          await Promise.all(spawned.map((task) => this.manager.foreground(task.id, 0, AbortSignal.abort())));
          this.changed();
          throw error;
        }
        this.changed();
        const results = await Promise.all(
          spawned.map(async (task) =>
            preview(await this.manager.foreground(task.id, (params.waitSeconds ?? 1) * 1000, signal)),
          ),
        );
        this.changed();
        return params.prompts ? results : results[0];
      }
      case "jobs.list": {
        const params = z.parse(List, input),
          all = this.manager.list();
        const cursor = Math.min(params.cursor ?? 0, all.length),
          count = params.count ?? 20;
        return {
          jobs: all.slice(cursor, cursor + count).map(preview),
          total: all.length,
          nextCursor: cursor + count < all.length ? cursor + count : undefined,
        };
      }
      case "jobs.inspect": {
        const params = z.parse(Inspect, input);
        return preview(this.manager.inspect(params.id, params.offset, params.limit));
      }
      case "jobs.input": {
        const params = z.parse(Input, input);
        if (params.data === undefined && !params.closeInput) throw new Error("Provide data or closeInput: true");
        return preview(
          params.data === undefined
            ? this.manager.closeInput(params.id)
            : await this.manager.write(params.id, params.data, params.closeInput),
        );
      }
      case "jobs.closeInput":
        return preview(this.manager.closeInput(z.parse(Id, input).id));
      case "jobs.stop": {
        const result = this.manager.kill(z.parse(Id, input).id);
        this.changed();
        return preview(result);
      }
      case "jobs.snooze": {
        if (!this.attention) throw new Error("Job attention is unavailable");
        const params = z.parse(Snooze, input),
          result = this.attention.snooze(params.id, params.minutes);
        return {
          ...preview(result),
          watchEnabled: this.attention.isWatched(params.id),
          snoozedMinutes: params.minutes,
        };
      }
      case "jobs.setWatch": {
        if (!this.attention) throw new Error("Job attention is unavailable");
        const params = z.parse(Watch, input),
          result = this.attention.setWatch(params.id, params.enabled);
        return { ...preview(result), watchEnabled: params.enabled };
      }
      default:
        throw new Error("Unknown job method: " + method);
    }
  }

  #record(input: JobDiagnosticInput): void {
    try {
      this.recordDiagnostic?.(input);
    } catch {
      if (!this.#diagnosticFailureReported) {
        this.#diagnosticFailureReported = true;
        console.error("Job diagnostic callback failed");
      }
    }
  }
}
