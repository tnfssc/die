# Persistent worktree instructions

Main put a release worktree in /tmp, so the user asked for a clear rule. The current workspace changed src/prompts/main-orchestrator.md and orchestrator.md. Use the managed subagent workspace API and keep the path it returns. Keep manual worktrees on persistent storage too. The CLI root is ~/.die/worktrees unless DIE_WORKTREE_ROOT overrides it. Never use /tmp or /var/tmp for ongoing implementation or release work. Record both path and branch. Temp directories remain fine for disposable tests and probes.

A regression was added to tests/prompts.test.ts. The prompt and preview suites passed: 15 tests and 163 assertions. Nothing was rebuilt, installed, or released. The changes were uncommitted in the feature workspace. They still had to be joined with the provider-default task without overwriting either side. The existing /tmp/die-release-051 worktree had not moved.
