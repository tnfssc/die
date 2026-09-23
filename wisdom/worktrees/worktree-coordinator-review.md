# Integration review (in progress)

The first CLI source pass found these blockers:
- resolveWorktreeSource now sends unvalidated baseRef to rev-parse --verify; explicitly reject option-looking/control-character refs and add --end-of-options before ref. Branch helper should independently reject option-looking/control refs, not rely only on call-site schema.
- Need workspace/preparation inspection status and stable identity for Git/setup failure and cancellation, not only success WorkspaceSummary. Preserve IDs/sibling ownership for batch preparation failures.
- Native batches need base pinned ONCE across launches. Current CLI note says it forwards optional workspace but does not yet describe native batch pinning. Coordinate with backend.
- Existing worker-produced notes use no trust decision details yet: use existing trusted root policy; do not introduce approval boolean/new framework.

Prompts changed only execute API facts + one judgment sentence in each orchestrator role; 20 focused prompt tests passed. Custom user base intentionally does NOT receive Die API prose; child role still injected, preserving old assembly behavior. Offline captured orchestrator input at /var/tmp/worktree-prompt-orchestrator.json.

## Native interim source concerns (12:10 UTC)

- DieTaskService delegatedWorkspace.baseRef now uses requestedWorkspace.baseRef ?? parent.thread.branch ?? HEAD, not pinned commit. Must resolve parent's actual current worktree cwd HEAD to immutable OID BEFORE durable delegation and return that OID. For explicit baseRef likewise resolve once. Native batch root then reuses first returned OID; see coordination note. Parent thread.branch may be stale and is not parent's current commit.
- scheduledWorkspaceTasks Ref<Set> now adds task IDs and has no delete; remove settled/cancelled entries / keep only active prep ownership, bounded by active work. Retained completed registry contradicts resource requirement.
- Required native workspace result schema shape (including uncertain status) must be copied to root strict adapter; default inherit results in tests fixtures need workspace too.
