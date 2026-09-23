# Integration review (in progress)

The first CLI source pass found these blockers:
- resolveWorktreeSource currently sends unvalidated baseRef to rev-parse --verify. Explicitly reject option-looking/control-character refs and add --end-of-options before ref. Branch helper should independently reject option-looking/control refs, not rely only on call-site schema.
- Need workspace/preparation inspection status and stable identity for Git/setup failure and cancellation, not only success WorkspaceSummary. Preserve IDs/sibling ownership for batch preparation failures.
- Native batches need base pinned ONCE across launches. Current CLI note says it forwards optional workspace but does not yet describe native batch pinning. Coordinate with backend.
- Existing worker-produced notes use no trust decision details yet: use existing trusted root policy. Do not introduce approval boolean/new framework.

Prompts changed only execute API facts + one judgment sentence in each orchestrator role; 20 focused prompt tests passed. Custom user base intentionally does NOT receive Die API prose. Child role still injected, preserving old assembly behavior. Offline captured orchestrator input at /var/tmp/worktree-prompt-orchestrator.json.

## Native interim source concerns (12:10 UTC)

- Fix DieTaskService before native batch work. delegatedWorkspace.baseRef currently chooses requestedWorkspace.baseRef ?? parent.thread.branch ?? HEAD. That is not a pinned commit. Resolve HEAD from the parent's real worktree cwd to an immutable OID before durable delegation. Resolve an explicit baseRef once the same way. Return that OID, then have the native batch root reuse the first returned OID. See the coordination note. Do not trust parent thread.branch as the current commit. It may be stale.
- scheduledWorkspaceTasks Ref<Set> currently adds task IDs and has no delete. Remove settled/cancelled entries / keep only active prep ownership, bounded by active work. Retained completed registry contradicts resource requirement.
- Required native workspace result schema shape (including uncertain status) must be copied to root strict adapter. Default inherit results in tests fixtures need workspace too.
