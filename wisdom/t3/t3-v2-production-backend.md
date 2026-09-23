# Native Die delegation backend owner

## Immediate contract / implementation locations (2026-09-21)

I will expose exactly four MCP tools in the existing authenticated `OrchestratorToolkit` route (so bearer-derived `McpInvocationContext`, never caller args/env):

- `die_task_launch` input `{ clientRequestId: string; prompt: string; profile: "fast" | "normal" | "orchestrator"; timeoutMs?: number }`
- `die_task_observe` input `{ taskId: string }`
- `die_task_cancel` input `{ clientRequestId: string; taskId: string }` (refinement: cancellation is mutating and needs its own durable replay key; launch shape remains exact)
- `die_task_list` input `{}`
- task result exactly `{ version: 1; taskId; childThreadId; childRunId?; childNodeId?; status: "running" | "completed" | "failed" | "cancelled"; profile; depth; output?; transferId? }`; list result exactly `{ tasks: result[] }`.

Locations owned/touched: `packages/contracts/src/orchestratorMcp.ts` (wire schemas), `apps/server/src/mcp/toolkits/orchestrator/{tools,handlers}.ts` (router), new `apps/server/src/mcp/DieTaskService.ts` and tests (policy/lifecycle), plus only the minimal runtime layer registration in `McpHttpServer.ts` and the async-launch non-ACK correction in `OrchestratorMcpService.ts`. Existing adapter transport/resource-owner files will not be touched.

Refinements proposed to root contract immediately:

1. Keep `clientRequestId` on cancel (same bounded nonblank format) because an ambiguous transport retry of a mutation otherwise has no durable identity.
2. Clarify `timeoutMs`: launch is always async and never delivers terminal output, so this cannot be a blocking wait budget. A child execution deadline needs a durable deadline event/reactor. Otherwise define it narrowly as launch-admission timeout.
3. Profiles/depth/Die-role policy are backend constants/config; reject non-Die bearer sessions and delegation from fast/normal roles, and reject depth at max. Do not accept provider/model/depth/parent IDs from tool args.
4. `observe` and `list` perform projection reads only and never dispatch completion-delivery/ACK/dispose events. Native T3 completion delivery remains sole wake/transfer owner.
5. Explicit cancel recursively interrupts only the target child subtree. Parent turn stop/settlement does not invoke it. Full server teardown uses provider-session ownership cleanup while durable lineage/events remain.

Durable launch dedupe will derive a stable command ID from bearer providerSessionId + clientRequestId and additionally bind the canonical request fingerprint so conflicting replay is rejected rather than aliasing. Child lineage comes from the durable subagent/context-transfer graph; every child is a distinct T3 provider session.

## Progress

Implemented in `.cache/die-t3code-v2-production`:

- Added exact contracts in `packages/contracts/src/orchestratorMcp.ts` and schema tests.
- Added `apps/server/src/mcp/DieTaskService.ts`: bearer-scoped Die/provider authorization, backend profile options and role prompts, lineage-derived depth/max-depth policy, stable command-receipt launch dedupe plus durable request-content conflict detection, async-only launch response, side-effect-free projection observation/listing, and descendant-first explicit subtree cancellation.
- Registered the four tools through the existing authenticated orchestrator MCP toolkit and runtime layer. No adapter transport/resource files were changed.
- Native child creation uses existing `delegated_task.request`, so T3 remains completion/wake/transfer owner and each child run receives the existing unique provider session lifecycle. No parent stop/settlement hook was added.

Checks:

- Contracts suite: 30 files / 504 tests pass (includes exact Die wire schema test).
- Focused backend suites: 3 files / 15 tests pass (`DieTaskService.test.ts`, `OrchestratorMcpService.test.ts`, orchestrator `tools.test.ts`). Tests cover always-async launch, authoritative profile option, projection-only observe/list (zero ACK/cancel calls), durable conflicting replay rejection, fast/normal denial, and descendant-before-root cancellation without siblings.
- Server typecheck passed after source wiring; a later workspace run is blocked by unrelated concurrently-added `NativeDieIntegration.production.test.ts` errors. Backend-owned files have no reported TS errors.
- `git diff --check` and formatter pass for owned files.

`timeoutMs` is validated and included in the durable launch fingerprint/child role envelope. The existing orchestration command has no durable deadline field, so this implementation does not invent an in-memory timer that would be lost on restart. Root contract should either define it as launch-admission timeout or add an owned durable deadline event/reactor before claiming child execution timeout semantics.


## Coordinator refinement implementation (06:05Z)

Implemented in `.cache/die-t3code-v2-production`:

- `die_task_cancel` is now exactly `{taskId}`. Descendant-first cancel replay keys are derived from durable parent thread + selected root task + descendant task, making repeated explicit cancellation naturally idempotent without a caller key.
- `timeoutMs` is **rejected before dispatch** with `invalid_request`: it is reserved as a child runtime deadline and is never interpreted as launch admission or silently ignored. The contract description states this limitation.
- Added trusted credential policy `dieDelegation:{profile,depth}`, derived at credential mint from server Die mode plus durable marked task lineage. Only the trusted Die `pi` instance receives it. Die credentials receive `die-delegation` instead of generic `orchestration`; so `delegate_task`, `task_status`, thread creation/scheduling/metadata tools cannot bypass profile/depth or ACK policy, while preview/worktree/pull-request/device capabilities remain independent. Native service uses a server-local orchestration scope only for its exact operations.
- Backend resolves `~/.die/subagents.json` (or server-owned `DIE_SUBAGENT_PROFILES_PATH`) on launch and passes exact configured model plus `thinking` option and instruction role. Missing profile fields inherit the parent selection as Die CLI does. Added exact fast/normal mapping tests.
- Max depth is the documented two-level bound; fast/normal bearer roles cannot launch. Role no longer comes from mutable thread model/options. Non-Die and unmarked/forged lineage resolve no Die policy.
- MCP command/thread/message replay IDs now bind stable thread identity rather than ephemeral provider-session ID, so provider restart replay reaches the same durable receipt and conflicting content is rejected before graph side effects.
- `die_task_list` now accepts `{cursor?,count?}` (default 20, max 100), returns `{tasks,total,nextCursor?}`, and leaves out outputs. `observe` caps output at 64k characters and sets optional `outputTruncated:true`.

Root schema updates required before conformance can pass:

1. Add optional `outputTruncated:boolean` to `T3TaskResultSchema`.
2. Change `T3TaskListInputSchema` to optional `cursor` (max 64) and integer `count` 1..100.
3. Change list result to required integer `total>=0` and optional `nextCursor`. Update adapter list API/paging and fixture list result with `total`.
4. Keep cancel exactly `{taskId}`. Keep launch timeout field only if root surfaces the backend's explicit unsupported child-deadline error. Do not describe it as a wait/admission timeout.

Actual schema conformance run passes launch/observe/cancel and then correctly fails at list fixture missing required `total`; rerun after root owns the above sync.

PiAdapter coordination: no further adapter edit is needed for profile mapping. Existing preserved PiAdapterV2 already applies `modelSelection.model`, `thinking`, then `/mode <instructionMode>`; backend now supplies those trusted values.
