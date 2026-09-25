import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as z from "zod/mini";
import {
  getJobRequestIdentity,
  getJobResponseDeliverySignal,
  JOB_RESPONSE_ACK_EVENT,
  supportsJobResponseAcknowledgement,
} from "../job-delivery";
import { prepareAgentSession } from "./agent-session";
import { type JobAttentionScheduler, MAX_SNOOZE_MINUTES } from "./job-attention";
import { sessionIdentity } from "../session/identity";
import { canDelegate, loadProfiles, resolveProfile, SUBAGENT_TYPES } from "./subagent-profiles";
import { T3LaunchIdentityLedger } from "../t3/tasks/launch-identity";
import { scrubT3BridgeEnvironment } from "../delegation-environment";
import { type T3BridgeEnvironment, T3McpClient, t3BridgeEnvironment } from "../t3/tasks/mcp-client";
import {
  T3NativeTaskAdapter,
  type T3TaskAdapter,
  type T3TaskProfile,
  type T3TaskResult,
  T3TaskResultSchema,
} from "../t3/tasks/native-task";
import { type TaskManager, type TaskSummary, utf8SafeSlice } from "./task-manager";
import { boundedMiddlePreview } from "./text-preview";
import { createWorktree, resolveWorktreeSource, setupShell, type WorkspaceRequest } from "./worktree-workspace";

const waitSeconds = z.optional(z.number().check(z.minimum(0), z.maximum(86400)));
const timeoutSeconds = z.optional(z.number().check(z.minimum(0.1), z.maximum(86400)));
const Shell = z.strictObject({
  command: z.string().check(z.minLength(1)),
  waitSeconds,
  timeoutSeconds,
  closeInput: z.optional(z.boolean()),
});
const Workspace = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("inherit") }),
  z.strictObject({
    kind: z.literal("worktree"),
    baseRef: z.optional(
      z.string().check(
        z.minLength(1),
        z.maxLength(256),
        z.refine((value) => !value.startsWith("-") && !/[\x00-\x20\x7f]/.test(value), "Invalid base ref"),
      ),
    ),
    branch: z.optional(
      z.string().check(
        z.minLength(1),
        z.maxLength(256),
        z.refine((value) => !value.startsWith("-") && !/[\x00-\x1f\x7f]/.test(value), "Invalid branch"),
      ),
    ),
  }),
]);
const Agent = z.strictObject({
  type: z.optional(z.enum(SUBAGENT_TYPES)),
  prompt: z.optional(z.string().check(z.minLength(1))),
  prompts: z.optional(z.array(z.string().check(z.minLength(1))).check(z.minLength(1))),
  title: z.optional(z.string().check(z.minLength(1), z.maxLength(120))),
  workspace: z.optional(Workspace),
  waitSeconds,
  timeoutSeconds,
});
const List = z.strictObject({
  cursor: z.optional(z.union([z.int().check(z.minimum(0)), z.string().check(z.maxLength(256))])),
  count: z.optional(z.int().check(z.minimum(1), z.maximum(100))),
});
const Inspect = z.strictObject({
  id: z.string(),
  offset: z.optional(z.int().check(z.minimum(0))),
  limit: z.optional(z.int().check(z.minimum(1), z.maximum(5000))),
});
const Input = z.strictObject({
  id: z.string(),
  data: z.optional(z.string()),
  closeInput: z.optional(z.boolean()),
});
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
    ...(job.agent
      ? {
          quietForMs: Math.max(0, end - Date.parse(job.agent.lastActivityAt ?? job.startedAt)),
        }
      : {}),
  };
}
export interface JobDiagnosticInput {
  component: "jobs";
  code: "JOBS_OPERATION_DISPATCH" | "JOBS_NATIVE_ACK_CLEANUP_FAILED";
  outcome: "success" | "failed" | "cancelled";
  operationId: string;
  taskId?: string;
  dispatch: "initiated" | "response";
  cancellation?: "caller";
  count?: number;
}
export type JobDiagnosticRecorder = (input: JobDiagnosticInput) => void;
export type T3TaskAdapterFactory = (config: Extract<T3BridgeEnvironment, { kind: "remote" }>) => T3TaskAdapter;

type MixedListCursor = {
  phase: "local" | "native";
  localLimit: number;
  localOffset: number;
  nativeCursor: string;
};
const MIXED_CURSOR_PREFIX = "t3v1.";

function encodeMixedCursor(cursor: MixedListCursor): string {
  return MIXED_CURSOR_PREFIX + Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeMixedCursor(value: string): MixedListCursor {
  if (!value.startsWith(MIXED_CURSOR_PREFIX)) throw new Error("Invalid jobs.list cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value.slice(MIXED_CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid jobs.list cursor");
  }
  const cursor = parsed as Partial<MixedListCursor>;
  if (
    !cursor ||
    (cursor.phase !== "local" && cursor.phase !== "native") ||
    !Number.isSafeInteger(cursor.localLimit) ||
    cursor.localLimit! < 0 ||
    !Number.isSafeInteger(cursor.localOffset) ||
    cursor.localOffset! < 0 ||
    cursor.localOffset! > cursor.localLimit! ||
    typeof cursor.nativeCursor !== "string" ||
    cursor.nativeCursor.length > 64
  )
    throw new Error("Invalid jobs.list cursor");
  return cursor as MixedListCursor;
}

export class JobService {
  #diagnosticFailureReported = false;
  #inspectionFailureReported = false;
  constructor(
    readonly manager: TaskManager,
    private policy: () => { depth: number; type?: string },
    private changed?: () => void,
    private profilesPath?: string,
    private attention?: JobAttentionScheduler,
    private recordDiagnostic?: JobDiagnosticRecorder,
    private environment: NodeJS.ProcessEnv = process.env,
    private nativeAdapterFactory: T3TaskAdapterFactory = (config) =>
      new T3NativeTaskAdapter(new T3McpClient(config.url, config.token)),
    private beforeLocalShellLaunch?: () => void,
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

  async #withNative<T>(
    config: Extract<T3BridgeEnvironment, { kind: "remote" }>,
    work: (adapter: T3TaskAdapter) => Promise<T>,
  ): Promise<T> {
    const adapter = this.nativeAdapterFactory(config);
    let result: T;
    try {
      result = await work(adapter);
    } catch (error) {
      await adapter.close().catch(() => undefined);
      throw error;
    }
    await adapter.close();
    return result;
  }

  #launchLedger(ctx: ExtensionContext): T3LaunchIdentityLedger {
    const sessionFile = ctx.sessionManager?.getSessionFile();
    if (!sessionFile) throw new Error("T3 native launch requires a durable parent session");
    const path = `${sessionFile}.t3-launches-v1.json`;
    return new T3LaunchIdentityLedger(path);
  }

  async #acknowledgeLaunch(
    ledger: T3LaunchIdentityLedger,
    clientRequestId: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (!supportsJobResponseAcknowledgement(signal)) {
      await ledger.acknowledge(clientRequestId);
      return;
    }
    getJobResponseDeliverySignal(signal)?.addEventListener(
      JOB_RESPONSE_ACK_EVENT,
      () => {
        void ledger.acknowledge(clientRequestId).catch(() => {
          // Keeping the pending key is safe: replay still names the same child.
          // Disk failure must not become an unhandled rejection after delivery.
          this.#record({
            component: "jobs",
            code: "JOBS_NATIVE_ACK_CLEANUP_FAILED",
            outcome: "failed",
            operationId: randomUUID(),
            dispatch: "response",
          });
        });
      },
      { once: true },
    );
  }

  #nativeProjection(result: T3TaskResult, omitOutput = false): Record<string, unknown> {
    const projected = { ...result } as Record<string, unknown>;
    // T3 is the sole terminal-delivery owner. Launch never carries a terminal
    // answer into Die's completion/notification path.
    if (omitOutput) delete projected.output;
    return {
      ...projected,
      id: result.taskId,
      kind: "agent",
      background: true,
      deliveryMode: "native-async",
    };
  }

  #isLocalTask(id: string): boolean {
    return this.manager.list().some((task) => task.id === id);
  }

  async #handle(method: string, value: unknown, ctx: ExtensionContext, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const input = flatten(value ?? {});
    switch (method) {
      case "shell": {
        const params = z.parse(Shell, input);
        if (!params.command.trim()) throw new Error("shell requires a nonempty command");
        this.beforeLocalShellLaunch?.();
        const executable =
          process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : (process.env.SHELL ?? "/bin/sh");
        const task = this.manager.spawn({
          kind: "command",
          command: executable,
          args: process.platform === "win32" ? ["/d", "/s", "/c", params.command] : ["-lc", params.command],
          displayCommand: params.command,
          cwd: ctx.cwd,
          closeStdin: params.closeInput ?? true,
          timeoutMs: params.timeoutSeconds ? params.timeoutSeconds * 1000 : undefined,
          notifyOnComplete: false,
          env: scrubT3BridgeEnvironment(process.env),
        });
        this.#refresh();
        const result = await this.manager.foreground(task.id, (params.waitSeconds ?? 3) * 1000, signal);
        this.#refresh();
        return preview(result);
      }
      case "subagent": {
        const params = z.parse(Agent, input);
        if (params.prompt && params.prompts) throw new Error("Use prompt or prompts, not both");
        const prompts = params.prompts ?? (params.prompt ? [params.prompt] : []);
        if (!prompts.length || prompts.some((prompt) => !prompt.trim()))
          throw new Error("subagent requires nonempty prompt(s)");
        const type = (params.type ?? "normal") as T3TaskProfile;
        const workspace = (params.workspace ?? { kind: "inherit" }) as WorkspaceRequest;
        if (prompts.length > 1 && workspace.kind === "worktree" && workspace.branch)
          throw new Error("An explicit workspace branch is only valid for a single prompt");
        const bridge = t3BridgeEnvironment(this.environment);
        if (bridge.kind === "remote") {
          if (params.waitSeconds !== undefined && params.waitSeconds !== 0)
            throw new Error(
              "Positive waitSeconds is unsupported for scoped native subagents; omit it or use 0 for asynchronous launch",
            );
          if (params.timeoutSeconds !== undefined)
            throw new Error(
              "timeoutSeconds is unsupported for scoped native subagents; use jobs.stop(id) for cancellation",
            );
          const requestIdentity = getJobRequestIdentity(signal);
          if (!requestIdentity)
            throw new Error("Scoped native launch requires durable execute invocation and call identity");
          const ledger = this.#launchLedger(ctx);
          const results = await this.#withNative(bridge, async (adapter) => {
            const launched: Record<string, unknown>[] = [];
            let pinnedBaseRef: string | undefined;
            try {
              for (const [index, prompt] of prompts.entries()) {
                signal.throwIfAborted();
                const fingerprint = T3LaunchIdentityLedger.fingerprint([
                  "execute-call-v1",
                  requestIdentity.executeInvocationId,
                  String(requestIdentity.callIndex),
                  String(index),
                ]);
                const clientRequestId = await ledger.reserve(fingerprint);
                signal.throwIfAborted();
                const result = z.parse(
                  T3TaskResultSchema,
                  await adapter.launch(
                    {
                      clientRequestId,
                      prompt,
                      profile: type,
                      ...(params.title === undefined ? {} : { title: params.title }),
                      ...(params.workspace === undefined
                        ? {}
                        : {
                            workspace:
                              params.workspace.kind === "worktree" && pinnedBaseRef
                                ? { ...params.workspace, baseRef: pinnedBaseRef }
                                : params.workspace,
                          }),
                      ...(params.timeoutSeconds === undefined ? {} : { timeoutMs: params.timeoutSeconds * 1000 }),
                    },
                    signal,
                  ),
                );
                if (params.workspace?.kind === "worktree") {
                  if (result.workspace?.kind !== "worktree")
                    throw new Error("Native backend returned mismatched workspace");
                  if (pinnedBaseRef !== undefined && result.workspace.baseRef !== pinnedBaseRef)
                    throw new Error("Native backend changed the pinned batch base");
                  pinnedBaseRef ??= result.workspace.baseRef;
                }
                // The authenticated backend is authoritative for effective profile and
                // depth. The strict adapter validates the profile enum; do not compare
                // either value with process-local DIE_SUBAGENT_* policy.
                await this.#acknowledgeLaunch(ledger, clientRequestId, signal);
                launched.push(this.#nativeProjection(result, true));
              }
            } catch (error) {
              if (!launched.length) throw error;
              const ids = launched.map((item) => String(item.id)).join(", ");
              throw new Error("Native batch launch failed; retained launched task IDs: " + ids, { cause: error });
            }
            return launched;
          });
          return params.prompts ? results : results[0];
        }
        const { depth, type: parentType } = this.policy();
        if (depth >= 2) throw new Error("Delegation is limited to two levels below the root");
        if (!canDelegate(depth, parentType)) throw new Error("Only orchestrator agents can delegate");
        if (depth > 0 && type === "orchestrator")
          throw new Error("Spawned orchestrators may only delegate to fast/normal workers");
        const { model, thinking } = resolveProfile(await loadProfiles(this.profilesPath), type, {
          model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
          thinking: ctx.thinkingLevel,
        });
        // Inherited launches retain their established spawn/wait/failure ownership.
        if (workspace.kind === "inherit") {
          const spawned: TaskSummary[] = [];
          try {
            for (const prompt of prompts) {
              signal.throwIfAborted();
              const prepared = await prepareAgentSession(
                ctx.cwd,
                ctx.sessionManager?.getSessionDir(),
                {
                  type,
                  model,
                  thinking,
                  depth: depth + 1,
                  parentSessionFile: ctx.sessionManager ? sessionIdentity(ctx.sessionManager)?.file : undefined,
                },
                undefined,
                params.title,
              );
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
                  displayCommand: "die agent [" + type + "]: " + (params.title ?? prompt),
                  cwd: ctx.cwd,
                  env: {
                    ...scrubT3BridgeEnvironment(process.env),
                    DIE_SUBAGENT_DEPTH: String(depth + 1),
                    DIE_SUBAGENT_TYPE: type,
                  },
                  timeoutMs: params.timeoutSeconds ? params.timeoutSeconds * 1000 : undefined,
                  closeStdin: true,
                  notifyOnComplete: false,
                }),
              );
            }
          } catch (error) {
            // A failed batch has no response in which to return already-spawned
            // identities. Stop those agents and transfer completion ownership to
            // session notifications so neither the jobs nor their IDs are lost.
            for (const task of spawned) {
              try {
                this.manager.kill(task.id, "execute-cancellation");
              } catch {
                // Cleanup must never replace the launch failure reported to the caller.
              }
            }
            await Promise.all(
              spawned.map(async (task) => {
                try {
                  await this.manager.foreground(task.id, 0, AbortSignal.abort());
                } catch {
                  // Preserve the original launch failure even if ownership transfer fails.
                }
              }),
            );
            this.#refresh();
            throw error;
          }
          this.#refresh();
          const results = await Promise.all(
            spawned.map(async (task) =>
              preview(await this.manager.foreground(task.id, (params.waitSeconds ?? 1) * 1000, signal)),
            ),
          );
          this.#refresh();
          return params.prompts ? results : results[0];
        }
        const launchStarted = Date.now();
        const reserved = prompts.map((prompt) => {
          const id = "task_" + randomUUID().slice(0, 8);
          return this.manager.prepareAgent({
            id,
            displayCommand: "die agent [" + type + "]: " + (params.title ?? prompt),
            cwd: ctx.cwd,
            workspace:
              workspace.kind === "worktree"
                ? { kind: "worktree", path: ctx.cwd, baseRef: workspace.baseRef ?? "HEAD" }
                : { kind: "inherit", path: ctx.cwd },
            timeoutMs: params.timeoutSeconds ? params.timeoutSeconds * 1000 : undefined,
            notifyOnComplete: false,
          });
        });
        this.#refresh();

        // A batch resolves its source commit exactly once. Individual cancellation
        // does not disrupt siblings; Git is aborted when every reserved child is done.
        const sourceController = new AbortController();
        const preparationSignals = reserved.map((task) => this.manager.preparationSignal(task.id));
        const abortSourceIfUnused = () => {
          if (preparationSignals.every((item) => item.aborted) && !sourceController.signal.aborted)
            sourceController.abort(new Error("Workspace preparation cancelled"));
        };
        if (workspace.kind === "worktree")
          for (const item of preparationSignals) item.addEventListener("abort", abortSourceIfUnused, { once: true });
        const worktreeSourcePromise =
          workspace.kind === "worktree"
            ? (async () => {
                try {
                  return await resolveWorktreeSource(ctx.cwd, workspace.baseRef ?? "HEAD", sourceController.signal);
                } finally {
                  for (const item of preparationSignals) item.removeEventListener("abort", abortSourceIfUnused);
                }
              })()
            : Promise.resolve(undefined);

        const sourceTrusted = typeof ctx.isProjectTrusted === "function" && ctx.isProjectTrusted();
        const childContinuityArgs: string[] =
          workspace.kind === "worktree" ? [sourceTrusted ? "--approve" : "--no-approve"] : [];
        const optionBoundary = process.argv.indexOf("--");
        const optionArgs = process.argv.slice(0, optionBoundary < 0 ? process.argv.length : optionBoundary);
        for (let index = 0; index < optionArgs.length - 1; index++) {
          if (optionArgs[index] === "--system-prompt" || optionArgs[index] === "--append-system-prompt")
            childContinuityArgs.push(optionArgs[index], optionArgs[index + 1]);
        }

        const preparations = reserved.map(async (task, index) => {
          const prompt = prompts[index];
          const prepSignal = this.manager.preparationSignal(task.id);
          try {
            const worktreeSource = await worktreeSourcePromise;
            prepSignal.throwIfAborted();
            const workspaceSummary = worktreeSource
              ? await createWorktree(worktreeSource, {
                  taskId: task.id,
                  title: params.title ?? (prompts.length > 1 ? "agent-" + (index + 1) : undefined),
                  branch: workspace.kind === "worktree" ? workspace.branch : undefined,
                  signal: prepSignal,
                  onPlanned: (planned) => this.manager.updatePreparedWorkspace(task.id, planned),
                })
              : { kind: "inherit" as const, path: ctx.cwd };
            prepSignal.throwIfAborted();
            this.manager.updatePreparedWorkspace(task.id, workspaceSummary);

            if (worktreeSource?.setup) {
              const setupCommand = setupShell(worktreeSource.setup.command);
              const setupTask = this.manager.spawn({
                kind: "command",
                command: setupCommand.command,
                args: setupCommand.args,
                displayCommand: "worktree setup: " + worktreeSource.setup.command,
                cwd: workspaceSummary.path,
                env: {
                  ...scrubT3BridgeEnvironment(process.env),
                  T3CODE_PROJECT_ROOT: worktreeSource.sourcePath,
                  T3CODE_WORKTREE_PATH: workspaceSummary.path,
                  DIE_PROJECT_ROOT: worktreeSource.sourcePath,
                  DIE_WORKTREE_PATH: workspaceSummary.path,
                  NO_COLOR: "1",
                  FORCE_COLOR: "0",
                },
                closeStdin: true,
                notifyOnComplete: worktreeSource.setup.async,
              });
              workspaceSummary.setupTaskId = setupTask.id;
              workspaceSummary.setupStatus = "running";
              workspaceSummary.setupConfigDigest = worktreeSource.setup.configDigest;
              this.manager.updatePreparedWorkspace(task.id, workspaceSummary);
              if (worktreeSource.setup.async) {
                void this.manager.wait(setupTask.id).then((outcome) => {
                  this.manager.updateWorkspaceSetup(task.id, outcome.status === "completed" ? "completed" : "failed");
                });
              }
              if (!worktreeSource.setup.async) {
                let onAbort: (() => void) | undefined;
                try {
                  const outcome = await Promise.race([
                    this.manager.wait(setupTask.id),
                    new Promise<never>((_, reject) => {
                      onAbort = () => reject(prepSignal.reason ?? new Error("Worktree setup cancelled"));
                      prepSignal.addEventListener("abort", onAbort, { once: true });
                      if (prepSignal.aborted) onAbort();
                    }),
                  ]);
                  if (outcome.status !== "completed") throw new Error("Worktree setup failed: " + outcome.output);
                  workspaceSummary.setupStatus = "completed";
                  this.manager.updatePreparedWorkspace(task.id, workspaceSummary);
                } finally {
                  if (onAbort) prepSignal.removeEventListener("abort", onAbort);
                }
              }
            }

            prepSignal.throwIfAborted();
            const prepared = await prepareAgentSession(
              workspaceSummary.path,
              ctx.sessionManager?.getSessionDir(),
              {
                type,
                model,
                thinking,
                depth: depth + 1,
                parentSessionFile: ctx.sessionManager ? sessionIdentity(ctx.sessionManager)?.file : undefined,
              },
              task.id,
              params.title,
            );
            prepSignal.throwIfAborted();
            this.manager.activatePreparedAgent(task.id, {
              ...prepared,
              workspace: workspaceSummary,
              command: process.execPath,
              args: [
                ...childContinuityArgs,
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
              displayCommand: "die agent [" + type + "]: " + (params.title ?? prompt),
              cwd: workspaceSummary.path,
              env: {
                ...scrubT3BridgeEnvironment(process.env),
                DIE_SUBAGENT_DEPTH: String(depth + 1),
                DIE_SUBAGENT_TYPE: type,
              },
              timeoutMs: undefined,
              closeStdin: true,
              notifyOnComplete: false,
            });
          } catch (error) {
            const current = this.manager.inspect(task.id);
            if (current.status === "running") this.manager.failPreparedAgent(task.id, error);
          }
        });

        // Preserve inherit's historical behavior: session preparation completes
        // before its foreground wait starts. Worktree preparation remains async so
        // waitSeconds:0 can immediately return a cancellable managed identity.
        // Preparations settle independently through their reserved tasks.
        void preparations;
        this.#refresh();
        const results = await Promise.all(
          reserved.map(async (task) =>
            preview(
              await this.manager.foreground(
                task.id,
                Math.max(0, (params.waitSeconds ?? 1) * 1000 - (Date.now() - launchStarted)),
                signal,
              ),
            ),
          ),
        );
        this.#refresh();
        return params.prompts ? results : results[0];
      }
      case "jobs.list": {
        const params = z.parse(List, input);
        const local = this.manager.list().map(preview);
        const bridge = t3BridgeEnvironment(this.environment);
        const count = params.count ?? 20;
        if (bridge.kind !== "remote") {
          const offset = typeof params.cursor === "number" ? params.cursor : 0;
          const jobs = local.slice(offset, offset + count);
          return {
            jobs,
            total: local.length,
            nextCursor: offset + jobs.length < local.length ? offset + jobs.length : undefined,
          };
        }

        const state =
          typeof params.cursor === "string"
            ? decodeMixedCursor(params.cursor)
            : params.cursor !== undefined && params.cursor > local.length
              ? {
                  phase: "native" as const,
                  localLimit: local.length,
                  localOffset: local.length,
                  nativeCursor: String(params.cursor - local.length),
                }
              : {
                  phase: "local" as const,
                  localLimit: local.length,
                  localOffset: params.cursor ?? 0,
                  nativeCursor: "0",
                };
        const localEnd = Math.min(state.localLimit, local.length);
        const localPage =
          state.phase === "local"
            ? local.slice(Math.min(state.localOffset, localEnd), Math.min(localEnd, state.localOffset + count))
            : [];
        const localOffset = Math.min(localEnd, state.localOffset + localPage.length);
        const nativeCount = count - localPage.length;
        const nativePage = await this.#withNative(bridge, (adapter) =>
          adapter.list({ cursor: state.nativeCursor, count: Math.max(1, nativeCount) }, signal),
        );
        const nativeTasks =
          nativeCount > 0
            ? nativePage.tasks.slice(0, nativeCount).map((task) => this.#nativeProjection(task, true))
            : [];
        const jobs = [...localPage, ...nativeTasks];
        let nextCursor: string | undefined;
        if (localOffset < localEnd) {
          nextCursor = encodeMixedCursor({
            ...state,
            phase: "local",
            localOffset,
          });
        } else if (nativeCount === 0) {
          nextCursor = encodeMixedCursor({
            ...state,
            phase: "native",
            localOffset: localEnd,
          });
        } else if (nativePage.nextCursor !== undefined) {
          nextCursor = encodeMixedCursor({
            phase: "native",
            localLimit: state.localLimit,
            localOffset: localEnd,
            nativeCursor: nativePage.nextCursor,
          });
        }
        return { jobs, total: localEnd + nativePage.total, nextCursor };
      }
      case "jobs.inspect": {
        const params = z.parse(Inspect, input);
        if (this.#isLocalTask(params.id)) return preview(this.manager.inspect(params.id, params.offset, params.limit));
        const bridge = t3BridgeEnvironment(this.environment);
        if (bridge.kind === "remote") {
          const result = await this.#withNative(bridge, (adapter) => adapter.observe(params.id, signal));
          if (result.output === undefined) return this.#nativeProjection(result);
          const bytes = Buffer.from(result.output);
          const offset = Math.min(params.offset ?? 0, bytes.length);
          const window = bytes.subarray(offset, offset + (params.limit ?? 5000) + 3);
          const safe = utf8SafeSlice(window, params.limit ?? 5000);
          const nextOffset = offset + safe.end;
          return {
            ...this.#nativeProjection({
              ...result,
              output: window.subarray(safe.start, safe.end).toString("utf8"),
            }),
            requestedOffset: params.offset ?? 0,
            nextOffset,
            hasMore: nextOffset < bytes.length,
            outputLost: safe.start > 0,
            ...(result.outputTruncated ? { transcriptAvailableInChildThread: true } : {}),
          };
        }
        return preview(this.manager.inspect(params.id, params.offset, params.limit));
      }
      case "jobs.input": {
        const params = z.parse(Input, input);
        if (params.data === undefined && !params.closeInput) throw new Error("Provide data or closeInput: true");
        if (!this.#isLocalTask(params.id) && t3BridgeEnvironment(this.environment).kind === "remote")
          throw new Error("Input is unsupported for scoped native tasks");
        return preview(
          params.data === undefined
            ? this.manager.closeInput(params.id)
            : await this.manager.write(params.id, params.data, params.closeInput),
        );
      }
      case "jobs.closeInput": {
        const params = z.parse(Id, input);
        if (!this.#isLocalTask(params.id) && t3BridgeEnvironment(this.environment).kind === "remote")
          throw new Error("closeInput is unsupported for scoped native tasks");
        return preview(this.manager.closeInput(params.id));
      }
      case "jobs.stopWork": {
        // The manager belongs to this session. The native adapter's authenticated
        // list is likewise scoped by the backend; never enumerate global tasks.
        z.parse(z.strictObject({}), input);
        const results: Array<{
          id: string;
          kind: "local" | "native";
          outcome: "acknowledged" | "pending" | "finished" | "error";
          status?: string;
          error?: string;
        }> = [];
        const bridge = t3BridgeEnvironment(this.environment);
        let discoveryError: string | undefined;
        const nativeIds: string[] = [];
        if (bridge.kind === "remote") {
          try {
            await this.#withNative(bridge, async (adapter) => {
              let cursor: string | undefined;
              const seen = new Set<string>();
              // Listing must finish before cancellation, so a broken cursor cannot
              // silently turn a partial page into a claim of complete coverage.
              for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
                const page = await adapter.list({ count: 100, ...(cursor ? { cursor } : {}) }, signal);
                for (const task of page.tasks) if (task.status === "running") nativeIds.push(task.taskId);
                if (!page.nextCursor) return;
                if (seen.has(page.nextCursor)) throw new Error("Native task list repeated its cursor");
                seen.add(page.nextCursor);
                cursor = page.nextCursor;
              }
              throw new Error("Native task list exceeded 100 pages");
            });
          } catch (error) {
            discoveryError = error instanceof Error ? error.message : String(error);
          }
        }
        // Include local launches that arrived while native discovery was pending.
        for (const task of this.manager.list().filter((task) => task.status === "running")) {
          try {
            const stopped = this.manager.kill(task.id);
            results.push({
              id: task.id,
              kind: "local",
              outcome:
                stopped.status === "running" ? "pending" : stopped.status === "killed" ? "acknowledged" : "finished",
              status: stopped.status,
            });
          } catch (error) {
            results.push({
              id: task.id,
              kind: "local",
              outcome: "error",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (bridge.kind === "remote")
          for (const id of new Set(nativeIds)) {
            try {
              const stopped = await this.#withNative(bridge, (adapter) => adapter.cancel(id, signal));
              results.push({
                id,
                kind: "native",
                outcome:
                  stopped.status === "running"
                    ? "pending"
                    : stopped.status === "cancelled"
                      ? "acknowledged"
                      : "finished",
                status: stopped.status,
              });
            } catch (error) {
              results.push({
                id,
                kind: "native",
                outcome: "error",
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        this.#refresh();
        return {
          outcome:
            discoveryError || results.some((job) => job.outcome === "error")
              ? "partial"
              : results.some((job) => job.outcome === "pending")
                ? "pending"
                : "acknowledged",
          discoveryComplete: discoveryError === undefined,
          ...(discoveryError ? { discoveryError } : {}),
          jobs: results,
        };
      }
      case "jobs.stop": {
        const params = z.parse(Id, input);
        if (!this.#isLocalTask(params.id)) {
          const bridge = t3BridgeEnvironment(this.environment);
          if (bridge.kind === "remote") {
            const result = await this.#withNative(bridge, (adapter) => adapter.cancel(params.id, signal));
            this.#refresh();
            return {
              ...this.#nativeProjection(result, true),
              ...(result.status === "running" || result.status === "cancelled" ? { cancellationRequested: true } : {}),
            };
          }
        }
        const result = this.manager.kill(params.id);
        this.#refresh();
        return preview(result);
      }
      case "jobs.snooze": {
        const params = z.parse(Snooze, input);
        if (!this.#isLocalTask(params.id) && t3BridgeEnvironment(this.environment).kind === "remote")
          throw new Error("snooze is unsupported for scoped native tasks");
        if (!this.attention) throw new Error("Job attention is unavailable");
        const result = this.attention.snooze(params.id, params.minutes);
        return {
          ...preview(result),
          watchEnabled: this.attention.isWatched(params.id),
          snoozedMinutes: params.minutes,
        };
      }
      case "jobs.setWatch": {
        const params = z.parse(Watch, input);
        if (!this.#isLocalTask(params.id) && t3BridgeEnvironment(this.environment).kind === "remote")
          throw new Error("watch is unsupported for scoped native tasks");
        if (!this.attention) throw new Error("Job attention is unavailable");
        const result = this.attention.setWatch(params.id, params.enabled);
        return { ...preview(result), watchEnabled: params.enabled };
      }
      default:
        throw new Error(`Unknown job method: ${method}`);
    }
  }

  #refresh(): void {
    try {
      this.changed?.();
    } catch {
      // UI refresh is advisory and must not affect task launch or ownership.
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
