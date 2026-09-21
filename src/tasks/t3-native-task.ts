import * as z from "zod/mini";
import { McpAmbiguousResponseError, type T3McpClient, type T3ToolResult } from "./t3-mcp-client";

export const T3_NATIVE_TASK_TOOLS = {
  launch: "die_task_launch",
  observe: "die_task_observe",
  cancel: "die_task_cancel",
  list: "die_task_list",
} as const;

export const T3TaskProfileSchema = z.enum(["fast", "normal", "orchestrator"]);
export const T3TaskStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);
export const T3WorkspaceResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("inherit"), preparationStatus: z.literal("ready") }),
  z.strictObject({
    kind: z.literal("worktree"),
    baseRef: z.string().check(z.regex(/^[0-9a-fA-F]{40,64}$/)),
    branch: z.string().check(z.minLength(1), z.maxLength(256)),
    worktreePath: z.optional(z.string().check(z.minLength(1))),
    preparationStatus: z.enum(["preparing", "ready", "failed", "uncertain"]),
  }),
]);
export const T3TaskResultSchema = z.strictObject({
  version: z.literal(1),
  taskId: z.string().check(z.minLength(1)),
  childThreadId: z.string().check(z.minLength(1)),
  childRunId: z.optional(z.string().check(z.minLength(1))),
  childNodeId: z.optional(z.string().check(z.minLength(1))),
  status: T3TaskStatusSchema,
  profile: T3TaskProfileSchema,
  depth: z.int().check(z.minimum(1), z.maximum(2)),
  workspace: z.optional(T3WorkspaceResultSchema),
  output: z.optional(z.string()),
  outputTruncated: z.optional(z.boolean()),
  transferId: z.optional(z.string().check(z.minLength(1))),
});
export const T3TaskListResultSchema = z.strictObject({
  tasks: z.array(T3TaskResultSchema).check(z.maxLength(100)),
  total: z.int().check(z.minimum(0)),
  nextCursor: z.optional(z.string()),
});

export const T3WorkspaceRequestSchema = z.discriminatedUnion("kind", [
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
export const T3TaskLaunchInputSchema = z.strictObject({
  clientRequestId: z.string().check(z.minLength(1), z.maxLength(128)),
  prompt: z.string().check(z.minLength(1)),
  title: z.optional(z.string().check(z.minLength(1), z.maxLength(120))),
  workspace: z.optional(T3WorkspaceRequestSchema),
  profile: T3TaskProfileSchema,
  timeoutMs: z.optional(z.int().check(z.minimum(1), z.maximum(86400000))),
});
export const T3TaskIdInputSchema = z.strictObject({ taskId: z.string().check(z.minLength(1)) });
export const T3TaskListInputSchema = z.strictObject({
  cursor: z.optional(z.string().check(z.maxLength(64))),
  count: z.optional(z.int().check(z.minimum(1), z.maximum(100))),
});
export type T3TaskListInput = z.infer<typeof T3TaskListInputSchema>;

export type T3TaskProfile = z.infer<typeof T3TaskProfileSchema>;
export type T3TaskStatus = z.infer<typeof T3TaskStatusSchema>;
export type T3TaskResult = z.infer<typeof T3TaskResultSchema>;
export type T3TaskListResult = z.infer<typeof T3TaskListResultSchema>;
export type T3TaskLaunchInput = z.infer<typeof T3TaskLaunchInputSchema>;

export interface T3TaskAdapter {
  launch(input: T3TaskLaunchInput, signal?: AbortSignal): Promise<T3TaskResult>;
  observe(taskId: string, signal?: AbortSignal): Promise<T3TaskResult>;
  cancel(taskId: string, signal?: AbortSignal): Promise<T3TaskResult>;
  list(input?: T3TaskListInput, signal?: AbortSignal): Promise<T3TaskListResult>;
  close(): Promise<void>;
}

function structured(result: T3ToolResult): unknown {
  if (result.structuredContent === undefined) throw new Error("T3 native task tool returned no structured result");
  const value = result.structuredContent;
  // Effect MCP failureMode:return encodes a typed backend rejection as a
  // structured result, not necessarily isError:true. Never treat it as a task,
  // nor reflect its potentially sensitive message into execute output.
  if (value && typeof value === "object" && "code" in value && "message" in value) {
    const known = [
      "capability_denied",
      "parent_not_active",
      "provider_unavailable",
      "model_unavailable",
      "runtime_mode_escalation_denied",
      "interaction_mode_escalation_denied",
      "task_not_found",
      "task_not_cancellable",
      "thread_not_found",
      "run_not_found",
      "thread_not_sendable",
      "thread_not_interruptible",
      "invalid_request",
      "orchestration_error",
    ];
    const code = known.includes(String(value.code)) ? String(value.code) : "backend_rejected";
    throw new Error(`T3 native task rejected (${code})`);
  }
  return value;
}

/** Strict adapter for the backend-owned, versioned native task contract. */
export class T3NativeTaskAdapter implements T3TaskAdapter {
  constructor(private readonly client: T3McpClient) {}

  async launch(input: T3TaskLaunchInput, signal?: AbortSignal): Promise<T3TaskResult> {
    const args = z.parse(T3TaskLaunchInputSchema, input);
    let result: T3ToolResult;
    try {
      result = await this.client.callTool(T3_NATIVE_TASK_TOOLS.launch, args, signal);
    } catch (error) {
      // Launch is idempotent by its caller-persisted request ID. One replay closes
      // the commit-with-lost-response window without retrying caller cancellation.
      if (signal?.aborted || !(error instanceof McpAmbiguousResponseError)) throw error;
      result = await this.client.callTool(T3_NATIVE_TASK_TOOLS.launch, args, signal);
    }
    return z.parse(T3TaskResultSchema, structured(result));
  }

  async observe(taskId: string, signal?: AbortSignal): Promise<T3TaskResult> {
    return z.parse(
      T3TaskResultSchema,
      structured(
        await this.client.callTool(T3_NATIVE_TASK_TOOLS.observe, z.parse(T3TaskIdInputSchema, { taskId }), signal),
      ),
    );
  }

  async cancel(taskId: string, signal?: AbortSignal): Promise<T3TaskResult> {
    return z.parse(
      T3TaskResultSchema,
      structured(
        await this.client.callTool(T3_NATIVE_TASK_TOOLS.cancel, z.parse(T3TaskIdInputSchema, { taskId }), signal),
      ),
    );
  }

  async list(input: T3TaskListInput = {}, signal?: AbortSignal): Promise<T3TaskListResult> {
    return z.parse(
      T3TaskListResultSchema,
      structured(await this.client.callTool(T3_NATIVE_TASK_TOOLS.list, z.parse(T3TaskListInputSchema, input), signal)),
    );
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
