# Worktree + web subagent integration investigation

_Investigation complete. No product code changed._
_Date: 2026-09-21._

## Scope and source provenance

I checked the adopted immutable source, not `.cache/die-t3code`. `web/t3-source.json` pins T3 Code commit `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`. The adopted `web/t3.patch` SHA-256 is `a98ba10466328f7800f0d64a1f5df88dcf290980fdeb30e80a2412e6114f7e91`. I expanded that commit and applied that exact patch in `/var/tmp` only to inspect it. The status document names the same pin and patch. I did not build, start a server, install, update dependencies, or edit product code.

## Executive finding

Keep native Die delegation in charge. Do not hand launch ownership to `ThreadLaunchService`. That service creates or reuses an ordinary thread. It has no parent thread, parent run, parent node, or completion-transfer input, so it cannot create a lineage subagent. Calling `ThreadLaunchService` before `delegateTask` creates the wrong thread and lineage. Calling it after `delegateTask` fails the empty-thread reuse guard. Either order also gives two places ownership of idempotency and results.

Join the flows here: first let durable `delegated_task.request` atomically create the parent task edge, child lineage thread, child message, and deferred/preparing run. Then prepare that existing child thread and run with the workspace part of `ThreadLaunchService`. Only then release provider execution. Do not send workspace subagents through the ordinary-thread launch API.

## Verified current flow

1. Die `JobService` routes a scoped web `subagent` to `die_task_launch` with a ledger-stable `clientRequestId` derived from execute invocation, call ordinal and batch index (`src/tasks/job-service.ts:288-341`; `src/tasks/t3-launch-identity.ts`). CLI-local launch instead uses `prepareAgentSession` and `TaskManager.spawn` in the caller cwd (`job-service.ts:343-389`).
2. Adopted `DieTaskService.launch` authenticates `die-delegation`, enforces orchestrator/depth policy before launch, resolves profile model/thinking against the parent selection, then calls `OrchestratorMcpService.delegateTask(... mode: async ...)` (adopted `apps/server/src/mcp/DieTaskService.ts:290-352`).
3. `delegateTask` requires the active run to be owned by this MCP provider session and derives a stable command ID from scope + request key (`OrchestratorMcpService.ts:1272-1324`).
4. `delegated_task.request` derives stable task node, child thread and message IDs from that command. Creates an `app_owned` subagent edge and a real child thread with `lineage.parentThreadId`, `relationshipToParent: subagent`, and root lineage. Then dispatches the child message with `start_immediately` (`Orchestrator.ts:5922-6074`; `SubagentProjection.ts:40-80`). This durable graph drives cancellation, terminal result/context transfer, parent wake and visible child transcript.
5. `makeSubagentChildThread` spreads the parent thread before replacing identity/lineage. Consequently it currently inherits the parent's `branch` and `worktreePath`. It does not provision a fresh child worktree.

## What ThreadLaunchService does—and does not do

At the pin, `ThreadLaunchInput` has ordinary thread identity/project/model/mode and `workspaceStrategy` (`root`, `existing_worktree`, or `worktree`). But no parent lineage/task fields (`ThreadLaunchService.ts:46-95`). Its `thread.create` command has no lineage input (lines 656-685). Reuse permits only an empty active target-project thread with no messages/runs (lines 176-196). So it cannot be applied to the already-created delegated child.

Its useful preparation pipeline is real and should be reused/factored:

- creates a temporary branch when omitted, optionally fetches origin, creates the Git worktree, persists thread `branch/worktreePath` metadata (lines 252-354);
- runs `ProjectSetupScriptRunner` in the resolved cwd and records setup progress (lines 393-470);
- uses child message `dispatchMode: defer_start`, leaving the run `preparing`, then issues `prepared-run.release` only after required setup (lines 704-735, 471-485);
- issues `prepared-run.fail` on preparation error, keeping thread/message visible (lines 522-557);
- deduplicates concurrent scheduling only in memory by command ID (lines 559-590), while command receipts and derived IDs dedupe durable launch replay.

The setup runner reads already-running T3 project/server state: `setupProjectScript(resolveProjectScripts(settings, project))`. Overrides/defaults are resolved by `packages/shared/src/projectScripts.ts`, and only the first script marked `runOnWorktreeCreate` runs. It opens a thread terminal in the worktree and honors the script's `async` policy (`ProjectSetupScriptRunner.ts:56-74, 302-430`). Use this web setup/config source. Web must not invent a parallel config reader.

## Recommended API invariants

1. `workspace` is optional and `inherit` is the backward-compatible default in both CLI and web. No mode silently upgrades inherit to worktree.
2. One logical subagent launch has one owner: local `TaskManager`/session in CLI. The durable delegated command/task/thread graph in web. Workspace preparation never allocates a competing task/thread ID.
3. The stable launch identity covers prompt, profile **and normalized workspace intent**. Same identity + same arguments returns the same child. Same identity + changed arguments rejects before Git I/O.
4. Auth, active-parent ownership, profile and depth checks precede workspace side effects. Workspace options cannot bypass worker non-delegation or project/path authorization.
5. Child execution cannot begin until its workspace gate is ready. Failure/cancellation cannot race a later release.
6. Accepted web preparation is durable across response loss and server restart. Preparation effects are idempotent and ownership-verifiable.
7. Every child receives a distinct worktree unless the caller explicitly selected inherit. Paths are never caller-controlled in the shared subagent contract.
8. Cancellation preserves user work. Cleanup is explicit, ownership-checked and conservative. Branches/PR links are never silently deleted.
9. The result/observe surface identifies child thread and workspace state/linkage. Authoritative transcript and setup diagnostics stay on the visible child thread.
10. Setup policy is mode-owned: existing T3 effective project settings on web, an explicit trusted local source on CLI. Neither mode pretends it used the other's config.

## Recommended backend schema and flow

### Public/common API

Keep one CLI-facing API with optional strict workspace intent:

`subagent({ prompt|prompts, type?, workspace?: {kind:'inherit'} | {kind:'worktree', baseRef?, branch?}, ... })`.

Omission and `inherit` retain current behavior. A batch gets one worktree per child. An explicit single `branch` is ambiguous/colliding for `prompts`. Reject that combination unless a future per-item workspace array/template is deliberately designed.

The same normalized intent must enter `T3TaskLaunchInputSchema` and adopted `DieTaskLaunchInput`. Do not expose server filesystem `path` or `existing_worktree` in this subagent API. Those belong to ordinary T3 thread launch/handoff. Exposing them here would let a delegated model attach arbitrary paths and would break CLI parity.

### Durable delegation command/projection

Extend `delegated_task.request` (and its exact-schema tests) with normalized workspace intent. Include that intent in replay equivalence. Today profile is embedded in the marked task prompt. So reuse with a changed profile is detected. Workspace must likewise be durably compared rather than accepted as an out-of-band side effect.

For `worktree`, the handler should atomically persist:

- the existing parent task/node/turn item and lineage child thread;
- the child initial message and run in `preparing` (use `defer_start`, not `start_immediately`);
- a workspace-preparation record/intention keyed by stable launch command/task/child IDs, containing requested and resolved base, ownership/path/branch, state, attempt, and failure detail.

Then a preparation coordinator claims that durable intention, invokes the extracted existing T3 prep pipeline for that child thread/run, and releases or fails the prepared run. Every release must re-check that the task/run is still open and not cancelled. The `inherit` path can retain immediate start (or pass through a trivial ready gate).

Do not make `DieTaskService` call `ThreadLaunchService.launch`. A thin internal `prepareExistingThread({ownerCommandId, projectId, threadId, runId, workspaceIntent})`-style service is the seam. The orchestration command is still sole launch/ID/lineage owner. Prep owns only workspace metadata/setup/gate transition.

### Restart and idempotency

`ThreadLaunchService` keeps its scheduling set and `WorktreeSetupTracker` only in process memory. Replaying an ordinary launch can reschedule a run that is still `preparing`. An acknowledged native Die launch has no such replay guarantee after a server restart. Copying the function would leave accepted child tasks stranded.

Persist preparation intent/state and add startup/on-demand reconciliation for requested/in-progress records. Crash recovery should resume/reconcile, not declare user-visible failure solely because the server restarted. Use a deterministic child-owned worktree location/ownership marker and stable operation IDs so reconciliation can distinguish “created before crash” from a foreign branch/path. Terminal preparation failure should be durable and should not auto-loop. An explicit retry action creates/claims a new attempt on the same child lineage.

The launch response can continue to report task `status: running` for compatibility while optionally returning a nested workspace state. If clients need to distinguish preparation, version the strict result schema or add an optional strict `workspace` projection consistently in contracts and Die's Zod schemas.

## Cancellation, preparation failure, and follow-up

- **Cancellation before release:** existing delegated subtree cancellation must additionally cancel/mark the durable prep attempt. The release command must be fenced against cancellation. Interrupt terminals/fetch/setup owned by that attempt.
- **Cleanup safety:** adopted ordinary launch force-removes a newly created worktree only when tracked setup is cancelled before `markUncancellable` (`ThreadLaunchService.ts:487-516`). For subagents, never erase user work merely because cancellation occurred. Remove only an ownership-proven, unchanged/clean unexposed worktree. Otherwise retain it and surface path/branch and cleanup-required state. Never auto-delete the branch.
- **Preparation failure:** preserve visible child thread, message, branch/path (if created), setup tail and actionable error. Issue `prepared-run.fail` so normal delegated terminal/result/wake machinery settles the parent task. This propagation is plausible from existing run-terminal machinery but is **not yet proven for a lineage child prepared run**. Test it before implementation.
- **Follow-up while preparing:** ordinary message intake must not bypass the gate and start a provider in the wrong cwd. Prefer an actionable reject while preparing (simpler) or a durable queue behind the same gate. Do not silently steer a nonexistent provider. After failure, offer explicit retry-preparation versus continue-in-retained-workspace. After ready/terminal, existing child transcript follow-up can stay ordinary T3 message intake.
- **Cancellation vs transport:** preserve adopted semantics: MCP/HTTP disconnect does not cancel. Only explicit task cancellation does.

## Branch, PR, setup, and read-only settings linkage

Thread `branch` and `worktreePath` are already persisted and consumed by T3 VCS/terminal/UI behavior. The worktree strategy also records `baseRef` in setup tracking. Persist resolved base in the new durable preparation state because transient setup tracking is insufficient for restart.

PR linkage is thread-scoped, not task-scoped: contracts already support `linkedPullRequest` and `branchPullRequest`, and `ThreadPullRequestService` derives branch PR state from thread branch/worktree. Runtime instructions require explicit `link_pull_request` for PRs created/worked on. A correctly bound child thread therefore reuses existing PR discovery/linking. Do not add a second PR registry to Die tasks. Verify that metadata update triggers VCS/PR refresh after preparation.

For web, setup/default-origin policy must be read from existing T3 `ProjectService` + `ServerSettingsService`. The launch request should not mutate those settings. Any agent/API actions to inspect effective default/base/setup policy should be read-only and should redact command/config details as existing authorization requires. Settings edits stay user/UI operations. The internal prep service should not grant the child a generic settings-write or arbitrary worktree-path capability. `die-delegation`, active provider ownership, depth/profile policy and project access must all be checked before Git I/O.

For CLI, do not start or query T3. T3 settings are backend DB state and cannot be claimed as CLI setup policy. CLI needs an explicit trusted local/repo setup source or explicit override. Until that is defined, report setup as not configured rather than silently importing web settings.

## Shared core versus mode-specific adapters

**Recommendation: a small common contract/state vocabulary plus thin mode-specific adapters, not a shared T3 service implementation.**

A lightweight shared core may safely own pure validation/normalization, resolved-intent shape, state transitions, stable ownership naming, and cleanup decision rules. It must not import T3 Effect layers, DB, terminals, project settings or server runtime.

Adapters should own effects:

- CLI adapter: direct local Git/worktree operations, local trusted setup policy, `prepareAgentSession`/`TaskManager`, no server.
- Web adapter: existing `GitWorkflowService`, `ProjectSetupScriptRunner`, `WorktreeSetupTracker` UI feed, thread metadata and prepared-run commands inside the already-running T3 server.

A larger shared prep implementation would falsely unify different config/trust/terminal/persistence owners and risk dragging the web server into CLI. Duplicate only the thin effect wiring. Share invariants and conformance tests.

## Separate future UI concerns and dependencies

- **Sidebar grouping** is not required to launch safely. It depends on exposing existing durable `thread.lineage` in list/read models and choosing presentation/archival semantics. Do not infer groups from branch names or worktree paths.
- **Direct child follow-up updating the parent** is separate. It depends on defining a new completion/context-transfer/wake event for later child runs and idempotent delivery ownership. Current task result is tied to the delegated run/edge. Blindly treating every follow-up terminal as the original task result risks duplicate parent wakes/transfers. Preserve lineage and transcripts during workspace preparation now. Do not silently add this policy.

## Verified tests/evidence to extend

Existing proof points:

- adopted `apps/server/src/orchestration-v2/ThreadLaunchService.test.ts`: visible preparing run, worktree/setup failures, allocated-ID and concurrent replay dedupe, tracked setup cancellation;
- `ProjectSetupScriptRunner.test.ts`, `WorktreeSetupTracker.test.ts`, `mcp/WorktreeMcpService.test.ts`;
- adopted `mcp/DieTaskService.test.ts` and `OrchestratorMcpToolkit.integration.test.ts`: auth/depth/profile, stable native lineage/result/cancel behavior;
- root `tests/t3-native-routing.test.ts`, `tests/t3-production-bridge.test.ts`, `tests/subagent-extension.test.ts`: CLI-vs-native routing, strict bridge schemas and local behavior.

No tests were run in this investigation.

## Minimal experiments before implementation

1. In an isolated adopted-pin test layer, create a delegated child with a deferred run, invoke factored prep, and prove provider start observes the child worktree cwd only after required setup.
2. Fail setup and prove exactly one child terminal, parent task terminal, result/context transfer and parent wake. Child is still visible with path/branch/error.
3. Cancel at fetch, checkout, sync setup, and release race. Prove no provider starts, siblings survive, no dirty/user work is deleted, and replay cannot release.
4. Kill/recreate the service after (a) intent commit, (b) worktree creation before metadata commit, and (c) setup completion before release. Prove reconciliation produces one worktree, one run, one provider start.
5. Replay same `clientRequestId` concurrently and after restart with same and changed workspace args. Same returns identical task/thread, changed rejects with no extra Git side effect.
6. Batch two worktree children. Prove unique paths/branches and reject colliding explicit branch input.
7. Send follow-up during preparing and after failed prep to confirm the chosen reject/queue/retry contract never runs in parent cwd.
8. Verify branch metadata triggers existing VCS/PR lookup and explicit PR links stay attached to the child thread.
9. CLI conformance test with no T3 environment/process: direct Git prep, child cwd, stable local ownership/retry, cancellation retention, and explicit setup-source reporting.

## Unknown / decisions still required

- Exact CLI trust/config source and whether setup runs by default.
- Default `baseRef` semantics (parent branch, project branch, or resolved commit). Resolve once at acceptance and persist it. Do not let replay drift with HEAD.
- Follow-up behavior during/after failed preparation (reject, queue, or explicit retry UX).
- Safe cleanup threshold and retention UX for cancelled/failed child worktrees.
- Whether workspace state is added compatibly to task result v1 or requires result v2.
- Whether existing terminal run-failure effects already complete an `app_owned` delegated task for a prepared child. This needs experiment 2 rather than assumption.
