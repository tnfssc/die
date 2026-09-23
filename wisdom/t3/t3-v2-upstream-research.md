# T3 Code orchestration-v2 upstream research

**Research date:** 2026-09-20  
**Repository:** [pingdotgg/t3code](https://github.com/pingdotgg/t3code)  
**Die pin:** [719a76ca1dbf5490f1aa33ffb9966301e02be9a9](https://github.com/pingdotgg/t3code/commit/719a76ca1dbf5490f1aa33ffb9966301e02be9a9)  
**Primary v2 PR:** [#2829](https://github.com/pingdotgg/t3code/pull/2829), current researched head [a9b49a7df0a4261dcc438d4493cc3154a1d9819e](https://github.com/pingdotgg/t3code/commit/a9b49a7df0a4261dcc438d4493cc3154a1d9819e)  
**Observability slice:** [#4779](https://github.com/pingdotgg/t3code/pull/4779), final head [c0a38525eab4be5480a8f40bb0d5faceebab3fc4](https://github.com/pingdotgg/t3code/commit/c0a38525eab4be5480a8f40bb0d5faceebab3fc4)


## Executive conclusion

The local comment in packages/client-runtime/src/state/subagentRuntime.ts is directionally accurate but easy to overread.

1. **T3 orchestration-v2 is real and substantially implemented upstream**, with an event-sourced server runtime, projections, provider adapters, durable app-owned child tasks, a WebSocket command/RPC surface, and an authenticated MCP surface. The actual current source is on the still-open t3code/codex-turn-mapping branch in PR #2829, not in Die's pinned main revision.
2. **PR #4779 was not the v2 orchestrator and was never merged.** It was one stacked observability slice on top of the v2 branch: richer subagent identities, activations, usage, workflows, persistence, and provider projections. It was closed after being folded into the larger unmerged stack PR #4664. Exact PR #4779 commits are not ancestors of either the pinned revision or the current #2829 head.
3. **What did merge to main is PR #5219**, a deliberately zero-migration bridge for the *existing/main (v1) orchestrator*. It consumes provider-native Claude/Codex task signals, folds them client-side into a v2-shaped panel model, and explicitly says it has “no dependency on orchestrator v2 (#2829).” This is the source of the local subagentRuntime.ts comment and is present at the Die pin.
4. **Codex MultiAgent V2 is a provider-native Codex feature, not T3 orchestration-v2.** Main's legacy bridge maps Codex collabAgent/* child-thread signals into shared task.* activities. T3 v2 can also ingest provider-native subagents, but separately adds T3-owned cross-provider delegated tasks backed by T3 child threads.
5. **Die cannot use the v2 task API at its current pin.** The pinned tree has no apps/server/src/orchestration-v2, no packages/contracts/src/orchestrationV2.ts, no v2 MCP service, and no v2 RPC group. A repin to the unmerged #2829 branch (or a large port) is needed first. Once running that stack, Die could use either the low-level authenticated WebSocket orchestrationV2.dispatchCommand RPC or, from an active provider session, the higher-level authenticated MCP tools. The latter are session-scoped and are not a generic unauthenticated task service.

## Status matrix: implemented, merged, proposed, pinned

| Item | Upstream state | In Die pin? | Evidence |
|---|---|---:|---|
| Existing/main orchestration engine | Merged/main | Yes | apps/server/src/orchestration/** and packages/contracts/src/orchestration.ts at the pin |
| Native-provider observability bridge | Merged as [#5219](https://github.com/pingdotgg/t3code/pull/5219), merge commit [a2ca89aa](https://github.com/pingdotgg/t3code/commit/a2ca89aa10f13a2222e08afd98c66285121d5ba2) on 2026-08-06 | Yes | [pinned subagentRuntime.ts](https://github.com/pingdotgg/t3code/blob/719a76ca1dbf5490f1aa33ffb9966301e02be9a9/packages/client-runtime/src/state/subagentRuntime.ts), ProviderRuntimeIngestion.ts, CodexAdapter.ts |
| T3 orchestration-v2 core | Implemented on branch; PR [#2829](https://github.com/pingdotgg/t3code/pull/2829) **OPEN, unmerged**, non-draft, now “dirty” | No | current branch apps/server/src/orchestration-v2/**, contracts, docs, migrations, MCP |
| PR #4779 activation-rich observability model | Implemented historical stack; **CLOSED, unmerged** | No | [PR #4779](https://github.com/pingdotgg/t3code/pull/4779), head [c0a38525](https://github.com/pingdotgg/t3code/commit/c0a38525eab4be5480a8f40bb0d5faceebab3fc4) |
| Full #4779 series / UI | Converged into [#4664](https://github.com/pingdotgg/t3code/pull/4664); **CLOSED, unmerged** | No | author comment on #4779 and #4664 metadata |
| Current v2 subagent model | Implemented on current #2829 head; schema has since evolved and is not identical to #4779 | No | [current OrchestrationV2Subagent](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/packages/contracts/src/orchestrationV2.ts#L541-L579) |
| Codex MultiAgent V2 | Provider-native Codex runtime behavior, integrated by T3 | Provider integration yes; not T3 v2 | [pinned CodexAdapter.ts](https://github.com/pingdotgg/t3code/blob/719a76ca1dbf5490f1aa33ffb9966301e02be9a9/apps/server/src/provider/Layers/CodexAdapter.ts#L1037-L1304), [issue #3875](https://github.com/pingdotgg/t3code/issues/3875) |

The pin's commit is feat(web): choose queue or steer for follow-up messages (#11964), authored 2026-09-15. It contains merge commit a2ca89aa for #5219, but git merge-base --is-ancestor returned false for both #4779's head and #4664's head. Conversely, the current #2829 branch contains the Die pin as an ancestor, because that branch continues to merge/rebase main while remaining unmerged itself.

## What PR #4779 actually was

### Metadata and history

[#4779](https://github.com/pingdotgg/t3code/pull/4779) was titled **“feat(orchestration-v2): subagent observability — data model and providers (1/4)”**. GitHub reports:

- state: closed, not merged; final head c0a38525; base t3code/codex-turn-mapping;
- 9 commits, 40 changed files, +2181/-83;
- created 2026-07-28, closed 2026-08-03;
- final author comment: “Converged into #4664, which now carries the full series against the orchestrator-v2 base.” ([comment](https://github.com/pingdotgg/t3code/pull/4779#issuecomment-5171965618)).

Important commits include:

- [c1929c2b](https://github.com/pingdotgg/t3code/commit/c1929c2b5be71d03b9d25a1bcf6c4b3d84f4b604) — data model;
- [3d4bf8d8](https://github.com/pingdotgg/t3code/commit/3d4bf8d828db926bd272d6ca34ed37a31cfe764a) — provider population;
- [9c888b6b](https://github.com/pingdotgg/t3code/commit/9c888b6b1886a7b6608c8fcbbc5ca588f61b7445) — Claude workflow replay;
- [bcbab62d](https://github.com/pingdotgg/t3code/commit/bcbab62dc194c6754374990c06b488f8586db71c) and [c0a38525](https://github.com/pingdotgg/t3code/commit/c0a38525eab4be5480a8f40bb0d5faceebab3fc4) — review fixes/progress semantics.

Related historical attempts/stack slices were also closed unmerged: [#3650](https://github.com/pingdotgg/t3code/pull/3650), [#4220](https://github.com/pingdotgg/t3code/pull/4220), and [#4662](https://github.com/pingdotgg/t3code/pull/4662). #4662 was the “2/4” reuse/reattribution slice based on #4779's branch. #4664 eventually carried the full series but was itself closed without merge.

### Implemented model at #4779 head

At immutable head c0a38525, [packages/contracts/src/orchestrationV2.ts](https://github.com/pingdotgg/t3code/blob/c0a38525eab4be5480a8f40bb0d5faceebab3fc4/packages/contracts/src/orchestrationV2.ts#L447-L567) defines:

- OrchestrationV2SubagentUsage: token breakdown, tool uses, duration;
- OrchestrationV2SubagentRole: name and provider/app-default source;
- OrchestrationV2SubagentActivity and OrchestrationV2WorkflowPhase;
- stable OrchestrationV2Subagent identity with origin, provider/native and child-thread refs, kind, role, status, lifetime usage, currentActivationId, activationCount, workflow/membership, recent activity, and timestamps;
- one-shot OrchestrationV2SubagentActivation rows with ordinal, run/provider-turn attribution, status, per-activation usage, and timestamps.

It adds a subagent-activation.updated domain event and subagentActivations to OrchestrationV2ThreadProjection ([lines 1184–1193](https://github.com/pingdotgg/t3code/blob/c0a38525eab4be5480a8f40bb0d5faceebab3fc4/packages/contracts/src/orchestrationV2.ts#L1184-L1193), [1267–1274](https://github.com/pingdotgg/t3code/blob/c0a38525eab4be5480a8f40bb0d5faceebab3fc4/packages/contracts/src/orchestrationV2.ts#L1267-L1274)). Projection persistence used migration 045 and ProjectionStore. The client reducer upserted activations in packages/client-runtime/src/state/orchestrationV2Projection.ts.

[SubagentObservability.ts](https://github.com/pingdotgg/t3code/blob/c0a38525eab4be5480a8f40bb0d5faceebab3fc4/apps/server/src/orchestration-v2/SubagentObservability.ts) supplied stable activation IDs, default roles, bounded recent activity, max-merging of cumulative usage, and activation-to-lifetime accumulation. Provider event ingestion accepted subagent_activation.updated. Codex, Claude, ACP, Cursor, and OpenCode adapters were modified.

Crucially, this is an **observability/projection layer**, not the origin of task creation. The base v2 stack already had delegated_task.request. #4779 enriched that path so app-owned delegated tasks also created an activation and emitted both identity and activation events. See [historical Orchestrator.ts around dispatchDelegatedTaskRequest](https://github.com/pingdotgg/t3code/blob/c0a38525eab4be5480a8f40bb0d5faceebab3fc4/apps/server/src/orchestration-v2/Orchestrator.ts#L3867-L4040).

### The #4779 shape is not the current #2829 shape

At current #2829 head, OrchestrationV2Subagent still has durable app-owned/provider-native identity, child-thread linkage, wake/delivery policy, statuses, progress and result, but the separate activation array and the rich #4779 usage/workflow fields are absent from the current contract ([current schema](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/packages/contracts/src/orchestrationV2.ts#L541-L579)). So the local statement “field names and transition semantics copy #4779 exactly” describes the merged legacy bridge's intended mechanical swap at the time of #5219. It is **not proof that today's open v2 branch exposes exactly that old projection**.

A full pickaxe history for the later removal could not be completed: the partial clone repeatedly attempted lazy SSH blob fetches and timed out. The endpoint states and immutable trees are accessible, so the factual difference is verified. The precise intermediate removal commit is still unverified.

## What is in the pinned revision

The pinned tree does **not** contain:

- apps/server/src/orchestration-v2/;
- packages/contracts/src/orchestrationV2.ts;
- docs/orchestration-v2/;
- apps/server/src/mcp/OrchestratorMcpService.ts.

It does contain PR #5219's [subagentRuntime.ts](https://github.com/pingdotgg/t3code/blob/719a76ca1dbf5490f1aa33ffb9966301e02be9a9/packages/client-runtime/src/state/subagentRuntime.ts). The PR description is explicit:

> “Surface agents using only native provider emissions on the current orchestrator — no dependency on orchestrator v2 (#2829), zero migrations, zero new tables.”

That bridge:

- widens persisted legacy task.* / tool activity payloads;
- maps Claude task/workflow events and Codex collabAgent/* events;
- derives a roster client-side with foldSubagentActivities;
- exposes deriveAgentPanelModel({ agents, v2Projection }) where v2 wins if later supplied;
- does not itself create app-owned T3 child tasks.

This explains why absence of orchestration-v2 in the generated cache was meaningful only **after** checking upstream: it is absent because the pinned commit is main and v2 remains on an open branch, not because v2 source does not exist upstream.

## Actual orchestration-v2 architecture

The current #2829 head has first-party design docs under [docs/orchestration-v2](https://github.com/pingdotgg/t3code/tree/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/docs/orchestration-v2). Key documents are:

- [README](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/docs/orchestration-v2/README.md);
- [core graph/data model](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/docs/orchestration-v2/core-graph-and-data-model.md);
- [MCP server](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/docs/orchestration-v2/orchestrator-mcp-server.md);
- [thread lineage/context transfer](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/docs/orchestration-v2/thread-lineage-and-context-transfer.md);
- [feature lifecycles](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/docs/orchestration-v2/feature-lifecycles.md).

The durable graph distinguishes:

- **AppThread**: stable user-facing conversation and lineage;
- **Run**: counted app-level user turn;
- **RunAttempt**: one provider execution attempt (retry/steer/recovery can add attempts);
- **ExecutionNode**: graph node for root/subagent/tool/background work;
- provider session/thread/turn entities;
- context transfers/handoffs for fork, subagent spawn/result, and cross-provider movement.

Commands are serialized by OrchestratorV2; events and projections are committed by EventSinkV2/ProjectionStore; durable effects are executed separately; provider output is normalized by adapters and ProviderEventIngestorV2. RunExecutionServiceV2.startRootRun is an internal execution API requiring a fully constructed app thread, provider session runtime, run, root node, checkpoint scope, provider thread, attempt, message, model, and runtime policy—not an appropriate external creation API ([source](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/orchestration-v2/RunExecutionService.ts#L493-L528)).

## True thread and task creation/execution APIs

There are three distinct levels.

### 1. Durable command/RPC level

[OrchestrationV2Command](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/packages/contracts/src/orchestrationV2.ts#L2193-L2216) contains thread.create. This creates the thread projection. It does not by itself execute a provider turn.

[message.dispatch](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/packages/contracts/src/orchestrationV2.ts#L2400-L2431) creates/delivers the user message and durable run. dispatchMode controls whether it is deferred, starts immediately, steers, restarts, or queues. The contract exposes these via OrchestrationV2RpcSchemas.dispatchCommand, wired as authenticated WebSocket method orchestrationV2.dispatchCommand ([contract](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/packages/contracts/src/orchestrationV2.ts#L2903-L2907), [RPC declaration](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/packages/contracts/src/rpc.ts#L1429-L1431), [server handler](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/ws.ts#L1723-L1768)).

The shared application boundary is [ThreadManagementService](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/orchestration-v2/ThreadManagementService.ts#L269-L312): dispatch, projection/snapshot queries, project-scoped list, sendToThread, waitForThread, and interruptThread.

### 2. Higher-level launch API

[ThreadLaunchService.launch](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/orchestration-v2/ThreadLaunchService.ts#L59-L130) accepts project/model/runtime/interaction/workspace strategy and optional initial message. Its implementation:

1. validates/reuses or allocates a thread ID;
2. dispatches thread.create (or metadata claim);
3. dispatches the initial message.dispatch with defer_start, producing a durable run;
4. prepares root/worktree/setup asynchronously;
5. releases the prepared run so ordinary provider execution starts.

See [launch implementation](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/orchestration-v2/ThreadLaunchService.ts#L594-L778). The t3_thread_launch MCP tool uses this intake path and needs a full-access/default caller ([handler](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/mcp/toolkits/project/handlers.ts#L39-L92)).

### 3. T3-owned delegated child task API

The intended agent-facing API is MCP delegate_task, not a provider adapter call. The design doc explicitly says these are T3 operations, **not provider-native APIs**, and each delegated task creates a T3 child thread/run with only the supplied task prompt ([MCP doc lines 1–27](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/docs/orchestration-v2/orchestrator-mcp-server.md#L1-L27)).

The flow is:

1. provider calls authenticated delegate_task;
2. OrchestratorMcpService.delegateTask verifies an active parent run owned by that MCP provider session and resolves model/runtime/interaction constraints;
3. it dispatches delegated_task.request with parent thread/run/root node and task prompt ([service](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/mcp/OrchestratorMcpService.ts#L1269-L1321));
4. Orchestrator.dispatchDelegatedTaskRequest derives stable task node, child thread, child message and turn-item IDs; creates a child AppThread with relationshipToParent: subagent; creates the parent app_owned subagent/node/turn item; then internally dispatches message.dispatch start_immediately on the child ([source](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/orchestration-v2/Orchestrator.ts#L5659-L5912));
5. normal durable effects/provider ingestion execute the child;
6. terminalization creates/consumes subagent_result transfer and finalizes parent projections; async completion wakes/queues into the parent according to policy.

The authoritative lifecycle diagram is [MCP doc lines 381–413](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/docs/orchestration-v2/orchestrator-mcp-server.md#L381-L413).

The tool supports mode: async or wait; wait timeout does not cancel work, and task_status can retrieve it later. task_cancel disposes automatic delivery and requests interruption. The tool definition explicitly prefers provider-native subagent tools for same-provider work and T3 delegation for cross-provider/unavailable-native/explicitly-T3-owned work ([tools](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/mcp/toolkits/orchestrator/tools.ts#L42-L92)).

For ordinary top-level threads, create_threads is explicitly *not delegation* and issues thread.create plus optional message.dispatch start_immediately ([tool description](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/mcp/toolkits/orchestrator/tools.ts#L144-L155), [service](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/apps/server/src/mcp/OrchestratorMcpService.ts#L1474-L1570)).

## T3 v2 versus Codex MultiAgent V2

These names refer to different layers:

| T3 orchestration-v2 | Codex MultiAgent V2 |
|---|---|
| T3 application architecture and durable graph | Feature/protocol behavior of the Codex app-server/provider |
| Cross-provider; adapters for Codex, Claude, Cursor, ACP, OpenCode, etc. | Codex-specific child threads and collabAgentToolCall / collabAgent/* frames |
| Can create app_owned tasks via delegated_task.request | Creates provider_native subagents inside Codex |
| Owns T3 child AppThread, Run, node, transfers, receipts, persistence | Owns Codex-native child identity/turns; T3 observes/routes them |
| Agent-facing T3 MCP is one ingress | Native Codex tools/protocol are another source of events |

At the pin, [CodexAdapter.ts](https://github.com/pingdotgg/t3code/blob/719a76ca1dbf5490f1aa33ffb9966301e02be9a9/apps/server/src/provider/Layers/CodexAdapter.ts#L1037-L1304) says directly that synthetic collabAgent/* events are “native multi-agent v2 child-thread signals” mapped into shared task.* lifecycle. [Issue #3875](https://github.com/pingdotgg/t3code/issues/3875) separately describes an upstream Codex MultiAgent V2 regression in named custom-agent selection and states that T3 #2829 covers tracking/lifecycle/replay/context transfer, not Codex's earlier named-agent selection boundary. This is strong evidence that upstream itself treats them as separate systems.

## Could Die use it?

### At the current pin: no

There is no v2 contract, server runtime, migrations, RPC, MCP server integration, or projection store to call. The merged #5219 bridge is observability only. Passing a non-null v2Projection to deriveAgentPanelModel would render already-produced v2 state, but nothing in the pinned server produces that state or creates v2 tasks.

### On a v2-enabled upstream build: technically yes, with important choices

**As a normal app/client integration:** call authenticated WebSocket orchestrationV2.dispatchCommand. For an ordinary thread, use thread.create + message.dispatch, or expose/use the server's higher-level launch intake so workspace preparation is not bypassed. For a delegated task, direct delegated_task.request is technically accepted by the RPC schema, but it is low-level: Die must supply a now active parent thread/run/root node, valid target model selection, and non-escalating runtime/interaction settings, and must consume projection/events correctly.

**As an agent inside a T3 provider session:** use MCP delegate_task / task_status / task_cancel. This is the intended high-level task API. But the MCP endpoint is bearer-authenticated with a short-lived credential scoped to environment, parent thread, provider instance, and provider session. Credentials are minted before provider session open, idle/max-lifetime limited, revoked on release, and not persisted ([transport/auth doc](https://github.com/pingdotgg/t3code/blob/a9b49a7df0a4261dcc438d4493cc3154a1d9819e/docs/orchestration-v2/orchestrator-mcp-server.md#L29-L55)). Die cannot treat it as a global durable API token.

**For independent work:** t3_thread_launch is preferable to telling an agent to shell-create a worktree. It binds workspace before agent execution. For batches sharing the parent checkout, create_threads is the ordinary top-level API. Do not call RunExecutionServiceV2.startRootRun directly.

### Integration cost/risk

Adopting #2829 today means pinning an open, fast-moving branch: GitHub reports 585 commits, roughly +312k/-163k across 1450 changed files at the researched head, with merge state “dirty.” It replaces major contracts and client state, adds migrations and provider/session infrastructure, and current v2 schemas have already diverged from #4779's historical activation-rich model. A narrow cherry-pick of delegate_task is not realistic because it depends on the v2 graph, event/projection stores, effect worker, IDs/receipts, provider manager, finalization, context transfers, MCP credential lifecycle, and clients.

The practical options are:

1. **Wait for/track #2829, then repin and adapt Die's patch** to the stable merged API.
2. **Research branch integration** against a specific #2829 commit, accepting churn. Use WebSocket commands for app-level integration and MCP only when operating as the active provider agent.
3. **Remain on pinned main** and use only provider-native observability. Do not represent it as T3-owned task creation.

## Evidence access and limitations

- GitHub API, PR refs, immutable commits, comments, and public branch source were accessible. Historical deleted branch heads were fetched through refs/pull/4779/head and refs/pull/4664/head into separate research worktrees.
- No product code or the existing generated/cache checkout was edited. Research trees are under .agents/research-t3-v2*, separate from .cache/die-t3code.
- The external postplan spec linked by #5219 (https://n0hbggyouhn1.postplan.dev) was not relied on. #5219 itself says later live-test decisions superseded that spec and that the PR description is the shipping source of truth.
- GitHub's ordinary PR file/commit JSON is capped/truncated for huge PRs such as #2829/#4664. The actual branch Git tree and source were fetched instead, so source conclusions do not depend on that truncated listing.
- The exact later commit that removed #4779's separate activation model from current #2829 could not be established because a partial-clone pickaxe repeatedly timed out during lazy blob fetching. Both immutable endpoint schemas were directly inspected.
- Current #2829 URLs point at immutable researched head a9b49a7d. The branch itself is mutable; re-check PR metadata/head before implementation decisions.
