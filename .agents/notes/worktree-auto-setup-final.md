# CLI worktree automatic setup policy final

## Policy implemented

CLI-created worktrees now automatically execute the repository `t3.json` script whose `runOnWorktreeCreate` is `true`. Setup execution has no confirmation, project-trust, or approval gate.

Project trust remains intentionally separate: the child agent still receives the parent's explicit `--approve`/`--no-approve` continuity argument. An untrusted child therefore still runs in denied trust mode, but that no longer suppresses repository setup.

## Owned changes

- `src/tasks/job-service.ts`: removed the `sourceTrusted` conditional around worktree setup spawning; retained trust handling only for child-agent continuity.
- `src/tasks/worktree-workspace.ts`: removed obsolete `skipped-untrusted` setup status.
- `tests/worktree-workspace.test.ts`: replaced the old skip assertion with deterministic coverage proving setup completes and creates its marker even when `isProjectTrusted()` is false, while the child still receives `--no-approve`.
- `src/prompts/execute.md`: explicitly states CLI `t3.json` setup is automatic and has no confirmation/trust/approval gate.
- `docs/subagent-workspaces.md` and `docs/t3-v2-delegation-status.md`: document the same policy and distinguish setup execution from child trust mode.

## Verification

- `bun test tests/worktree-workspace.test.ts`: **9 pass, 0 fail** (36 assertions).
- `bunx tsc --noEmit`: **pass**.
- Targeted Biome formatting: pass/no fixes needed.
- `git diff --check` on owned source/test/docs files: pass.
- Follow-up search found no remaining `skipped-untrusted` or old trust-gated setup wording in source, tests, or user docs.

No canonical web checkout, patch artifact, or Git index was edited. Unrelated concurrent workspace changes were preserved.
