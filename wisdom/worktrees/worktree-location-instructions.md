# Persistent worktree instructions

Main had put a release worktree in `/tmp`, so the user asked for a clear instruction. The current workspace updated `src/prompts/main-orchestrator.md` and `orchestrator.md`. Use the managed subagent workspace API and the path it returns. Manual worktrees must persist. The CLI root is `~/.die/worktrees` or `DIE_WORKTREE_ROOT`. Do not use `/tmp` or `/var/tmp` for ongoing implementation or release work. Record the path and branch. Temporary tests and probes may still use a temp directory.

A regression was added to `tests/prompts.test.ts`. The prompt and preview suites passed: 15 tests and 163 assertions. Nothing was rebuilt, installed, or released. The changes were uncommitted in the feature workspace. They still had to be joined with the provider-default task without overwriting either side. The existing `/tmp/die-release-051` worktree had not moved.
