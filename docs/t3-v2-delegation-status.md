# Native T3 delegation: production integration status

The root bridge and canonical T3 backend implement native child-thread delegation.
The adopted source is pinned by `web/t3-source.json`; production changes are carried
only by `web/t3.patch`. This work does not install the application, publish a
release, or change a version.

## Upstream channel compatibility

The canonical pin is a native orchestration-v2 integration base, not evidence that
Die follows upstream's stable channel. Upstream **nightly** and **preview** are
separate release channels; a preview must not be described as a nightly.

As checked on 2026-09-22, the latest official nightly is
[v0.0.43-nightly.20260922.2083](https://github.com/pingdotgg/t3code/releases/tag/v0.0.43-nightly.20260922.2083)
at `0141bc2bf5fcf52a563240a6bce4b58050496db5`. It lacks the upstream
orchestration-v2 backend, native MCP contracts, and Pi driver used by our current
patch. Switching only the source pin fails patch application and would not
preserve native delegation. Keep the canonical pin unchanged until an explicit
channel/migration decision is made; do not silently replace native children with
local delegation or label the preview channel as nightly.

## Ownership and contract

T3 owns native child processes, threads, transcripts, graph state, persisted results,
and completion delivery. Die exposes read-through job metadata for those children;
it does not maintain a second child/output registry. Scoped execute does not fall back
to local subagents. Ordinary CLI delegation and local shell jobs remain separate.

The authenticated native MCP surface is:

- `die_task_launch({ clientRequestId, prompt, profile, title?, workspace? })`
- `die_task_observe({ taskId })`
- `die_task_cancel({ taskId })`
- `die_task_list({ cursor?, count? })` (maximum count 100)

Backend credentials bind role and depth to durable lineage. Fast and normal workers
cannot delegate; an orchestrator can launch fast or normal leaves. Observe and list do
not acknowledge completion delivery. Native launch is asynchronous: omitted or zero
`waitSeconds` returns a background result, while positive waits are rejected.
Native input, close-input, watch, and snooze operations are rejected.

Launch replay identity is derived from the durable execute invocation, call ordinal,
and batch index. Cancellation targets the selected subtree rather than siblings, and
transport closure does not itself cancel a child.

## Structured workspaces

A launch may request `workspace: { kind: "worktree", baseRef?, branch? }`; omission
means inherited workspace. Worktree results expose the immutable base revision,
branch, preparation state, and worktree path when available. Batch preparation pins a
common source revision, reports partial failures, and retains worktrees and branches
on failure or cancellation.

Local CLI setup automatically runs the source checkout's configured `t3.json`
`runOnWorktreeCreate` action, with no confirmation, project-trust, or approval gate.
Project trust still controls the child agent's own trust mode, not setup execution.
Native setup uses the backend's configured project-action policy. Setup is
owned, cancellable, and bounded; provider execution waits for required synchronous
preparation. See [subagent workspaces](subagent-workspaces.md) for user-facing batch
and inspection behavior.

## Validation status and limits

Focused deterministic coverage exists for:

- root routing, transport reconnect bounds, execute identity, and delivery ACKs;
- exact root/backend schemas for launch, observe, cancel, and list;
- profile/depth/tool scope, replay, cancellation, and read-only observation;
- local no-auth Host/Origin checks;
- native own/subtree usage accounting;
- synthetic prior-version migration and restart;
- worktree Git safety, automatic setup in untrusted projects, setup success/failure/timeout/cancellation,
  batch pinning and partial failure, replay ownership, and retained lifecycle;
- same-server browser completion, cancellation, reload, and shell-card preservation.

A coordinated live worktree run passed against an exact canonical checkout and
reviewed packaged executable. Earlier lifecycle, native, browser, migration,
preservation, and package runs are historical evidence rather than a promise that
all current repository tests pass. Resource probes demonstrate bounded queues and
repeated owned provider-process cleanup; they are not a general zero-leak claim.
No packaged compaction, mode-switch, or universal accounting claim is made.

## Reproduction

Portable commands and prerequisites are in
[the production harness README](../scripts/t3-v2-production/README.md). Retained
harnesses derive their default checkout from `web/t3-source.json`, use
`web/t3.patch`, and create private state under `TMPDIR` or the platform temporary
directory. They do not install dependencies.

The acceptance source set excludes generated proof, raw logs, screenshots, browser
profiles, binaries, caches, and local research state. Candidate build/export scripts
are research utilities and are not part of the recommended PR stage list.
