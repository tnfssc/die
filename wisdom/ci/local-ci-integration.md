# Local CI gate work (2026-09-25)

User asked for local checks that match CI after run `36106720762` failed on `develop` at `71a9dbf`. macOS Live passed; Linux deterministic suite failed `tests/job-attention.test.ts:211`: heap growth 34,446,931 bytes vs 20 MiB bound. Earlier push had focused checks, not the full CI sequence.

Work in progress:
- Scheduler diagnosis/fix: task `task_a32f2eaa`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_a32f2eaa`, branch `die/fix-scheduler-memory-ci-failure-a32f2eaa`.
- Shared local/CI runner: task `task_e6f73e2d`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_e6f73e2d`, branch `die/share-local-and-ci-check-runner-e6f73e2d`.

Both start at `71a9dbf`. Separate ownership. Review and integrate commits, then run the whole Linux gate before next push. Local Linux does not prove macOS behavior. Do not raise a memory threshold without diagnosing what it measures. Code placement audit runs separately; see `../quality/code-placement-audit.md`.
