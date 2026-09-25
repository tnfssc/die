# Local CI gate work (2026-09-25)

User asked for local checks that match CI after run `36106720762` failed on `develop` at `71a9dbf`. macOS Live passed; Linux deterministic suite failed `tests/job-attention.test.ts:211`: heap growth 34,446,931 bytes vs 20 MiB bound. Earlier push had focused checks, not the full CI sequence.

Completed worker assignments:
- Scheduler diagnosis/fix: task `task_a32f2eaa`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_a32f2eaa`, branch `die/fix-scheduler-memory-ci-failure-a32f2eaa`.
- Shared local/CI runner: task `task_e6f73e2d`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_e6f73e2d`, branch `die/share-local-and-ci-check-runner-e6f73e2d`.

Both started at `71a9dbf`. Separate ownership. Commits integrated; full Linux gate passed as recorded below. Local Linux does not prove macOS behavior. Do not raise a memory threshold without diagnosing what it measures. Code placement audit runs separately; see `../quality/code-placement-audit.md`.

## Integration

Integrated scheduler change as `dba4adc` and shared runner as `26808b5`. Review caught old workflow-shape assertions in `tests/live-macos-ci.test.ts` and `tests/release-workflows.test.ts`; they now verify workflow delegation and the shared script, keeping the source-only macOS contract. Focused runner/workflow/attention checks: 27 passed.

First full gate ran in task `task_d2864ec4`: `mise exec node@24.21.0 npm:pnpm@11.27.1 -- bun run ci`. Aggregate log `/tmp/die-full-local-ci.log`; durable per-step logs `artifacts/ci/`. Bun is 1.4.2, tmux is present. Installed tools without changing user defaults. Node installed via mise; the older mise aqua pnpm recipe did not match new release asset names, so used the npm backend for the same pinned pnpm version. No push yet.

First full run passed format, lint, typecheck, build, offline transport, and all web checks. Deterministic suite: 1050 passed, 17 skipped, 5 failed. One stale smoke-workflow assertion still expected inline YAML. Four Live snapshot tests hit a pre-existing shared temp snapshot budget. Scheduler test passed in suite context. Fixed the smoke assertion and gave each shared runner invocation a fresh `TMPDIR`, removed on exit. Isolation tests check success/failure cleanup and that pre-existing files are left alone. This does not delete real session snapshots or change their budget. Six runner/smoke tests passed. Full gate must rerun.

## Final local proof

Full shared Linux gate passed on code commit `c3f68ee` (task `task_d7242481`, exit 0). Exact command: `mise exec node@24.21.0 npm:pnpm@11.27.1 -- bun run ci`, with Bun 1.4.2. Format, lint, TypeScript, full CLI/web build, offline source/compiled transport, all web groups, deterministic tests and standalone smoke passed. Web: 260 backend + 158 model + 26 contracts + 9 projection tests. Root suite: 1055 passed, 17 skipped, 0 failed. Skips are the existing opt-in live/paid/TUI cases. Logs: `artifacts/ci/`, aggregate `/tmp/die-full-local-ci-2.log`.

Not pushed. Next: push and verify hosted Linux/macOS jobs. This local run proves Linux only; it used the existing verified pinned T3 checkout, not a fresh remote VM. Values changed only for the separate code-placement audit (value 3); CI work fits the existing proof and ownership values.
