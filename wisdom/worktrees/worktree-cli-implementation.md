# CLI worktree implementation handoff

Built workspace preparation that does not depend on a provider. It lives in `src/tasks/worktree-workspace.ts`. `JobService` now routes local work to it.

## Public/native serialization

`subagent` now accepts:

`{ prompt | prompts, type?, title?, workspace?: { kind: "inherit" } | { kind: "worktree", baseRef?, branch? }, waitSeconds?, timeoutSeconds? }`

Default/omitted workspace is inherit. `T3TaskLaunchInputSchema` carries optional `title` and the same optional `workspace` object. Remote routing forwards both only when supplied. Multi-prompt launch rejects an explicit branch before either local or native side effects. Backend/native implementation should consume these exact fields; no approval boolean or setup command is serialized.

## Local behavior

- Resolves top-level/common-dir and pins `baseRef^{commit}` once before a batch.
- Uses argv-only Git: `check-ref-format --branch`, non-adopting branch existence check, then `worktree add --no-track -b <new> <path> <oid>`. No fetch/reset/force/remove/prune/copy. Worktrees and branches are retained.
- Managed root defaults to `DIE_WORKTREE_ROOT` or `~/.die/worktrees`.
- Snapshots the first `runOnWorktreeCreate` command from source-root JSONC `t3.json`. `async:false` must complete successfully before child spawn; default async setup is a normal TaskManager command and child starts immediately. The child summary exposes workspace path/base OID/branch/setup task ID. Stopping/timing out the child also stops a still-running owned setup.
- Child session/profile/model/thinking/cost ancestry paths stay through existing `prepareAgentSession`; only child cwd changes. Wait and timeout budgets account for local worktree preparation, while inherit preserves old exact timing behavior.

Tests: `tests/worktree-workspace.test.ts` plus TaskManager ownership coverage. Fixtures are owned under `/var/tmp`.
