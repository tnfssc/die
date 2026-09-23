# T3 preview adoption semantic/resource acceptance

Date: 2026-09-22

## Result

Independent review of adopted preview base `b488c57f3f9f1688e31c53daee99e29dd1d0baa2` against the old canonical base/patch at `HEAD^` (base `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`) found the three manual conflict resolutions semantically additive:

- **Orchestrator:** preview usage-limit continuation validation/recovery is retained before Die local-job ownership fencing. Invalid/stale usage recovery and stopped local-job deliveries each receive durable no-op receipts. Die-owned ancestry revalidation remains under the thread serialization boundary, and capability-aware delegated wake text remains intact.
- **ProjectionStore:** preview targeted control reads and the required `Number(options.autoResume/snooze)` SQLite binding correction are retained with Die native usage. A concrete regression was found: every snapshot decoded every persisted thread and provider turn to calculate native usage. The patch now walks only the requested thread's `subagent` lineage, fetches provider turns only for that selected subtree, guards malformed unrelated JSON, and prevents lineage cycles from growing the frontier. A regression test leaves an unrelated malformed row present during a successful target snapshot.
- **MessagesTimeline.logic.test:** preview transcript tests and Die persistent-shell lifecycle tests are concatenated; the added provider-kind import is used. The focused file passes.

No loss of preview recovery/targeted control reads or Die native usage/owned-local-job behavior was found. The remaining subtree lookup scans thread lineage JSON once per depth in SQLite because lineage is not normalized/indexed; importantly it no longer transfers/decodes all global thread/turn payloads in JS. A future schema/index change may be warranted for very deep/high-cardinality stores.

Final patch: 541,108 bytes, SHA256 `3d343a59f2ca7a176ec2e93fc68200dea9e4ffd5fbce367e48903e2f70bd2530` before wrapper commit.

## Validation in independent clone

Clone: `.cache/t3-preview-semantic` (copied from read-only seed, seed never mutated). Old canonical comparison worktree: `.cache/t3-old-canonical` at detached `a9b49a7d` with the old patch applied.

- ProjectionStore: **1 file / 21 tests pass**, including SQLite boolean binding recovery and scoped malformed-row native usage regression.
- Pi adapter replay/fanout + client RPC replay/close + timeline conflict suite: **3 files / 197 tests pass**.
- ProviderSessionManager + ProviderContinuationService + LocalJobNotification + NativeUsageAccounting + Orchestrator control reads (plus production integration attempted together): non-live suites **5 files / 74 tests pass**. This covers queue byte/count bounds and retry release, local-job replay/ownership, targeted control reads, native accounting, real child-process PID and Linux `/proc/self/fd` plateau/release fixtures, idle/hung close, stream failure, cancellation and shutdown paths.
- Full workspace `pnpm fmt`: pass. Full workspace `pnpm typecheck`: pass (diagnostic suggestions only).
- Diff checks: pass.

## Blocker / non-claims

`NativeDieIntegration.production.test.ts` did not execute its native root-to-child scenario: its Pi RPC spawn failed with `NotFound` for this wrapper worktree's absent `dist/die`, then the test hit its 45-second timeout. So there is **no fresh real Die root→child/reconnect/cancel PID-shutdown acceptance claim** from this review. The failure occurred before provider PID creation and is an environment/artifact blocker, not a demonstrated candidate behavior failure. No portable binary/deploy, hostile auth matrix, migration/restart soak, universal-platform, or zero-leak claim was run.

Persistent paths/branches:

- wrapper worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_b0b5ca20`, branch `die/preview-semantic-and-resource-acceptance-b0b5ca20`
- independent candidate clone: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_b0b5ca20/.cache/t3-preview-semantic`, branch copied as `die-preview-probe`
- old canonical comparison worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_b0b5ca20/.cache/t3-old-canonical`, detached at `a9b49a7d`
- owner read-only seed remained `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_8a2c4ca2-a86675007a5e-task_02d7b006/.cache/t3-preview-candidate`

No release/version/tag/push was performed.
