# T3 v2 production continuation P1 fixes

Implemented in the isolated production tree at `.cache/die-t3code-v2-production`. No canonical re-export, adoption, dependency install, or NativeDieIntegration production-test change was performed.

## Changes

- Added capability-aware delegated-completion wake text in `DelegatedCompletionWake.ts`, used by both immediate/steered Orchestrator wake construction and projection-recovery dispatch in `ProviderContinuationService.ts`.
  - Durable app-owned tasks carrying the server's native Die prompt marker now tell Die to use `execute` + `jobs.inspect(id)` (backed by `die_task_observe`).
  - They never instruct the restricted Die credential to call `task_status`.
  - Ordinary orchestration tasks retain the existing `task_status` instruction.
  - Removed the inaccurate unconditional comment that `task_status` owns wake acknowledgement; provider acceptance and result observation remain separate and observation is capability-specific.
- Added real retained-payload bounds in `ProviderContinuationRequests.ts`:
  - 32 KiB UTF-8 maximum per free-form detail/notification field.
  - Oversized detail is UTF-8-safely truncated; oversized optional notification metadata is replaced by a bounded summary.
  - 1 MiB shared weighted semaphore budget covers fresh queued requests, in-flight dispatch, and requests transferred to/re-enqueued by the retry scheduler.
  - Reservations are released only on successful/discarded terminal dispatch processing; retry transfer/re-enqueue retains the same reservation.
  - Existing 256-item fresh/retry queue bounds, durable projection ownership/recovery, sole retry timer/worker, and tail re-enqueue sibling fairness are unchanged.

## Regression coverage

`ProviderContinuationService.test.ts` now verifies:

- oversized multibyte detail and notification values are bounded before retention;
- dequeuing into retry ownership does not free the shared byte budget, while terminal release does;
- durable native Die tasks receive `jobs.inspect` / `die_task_observe` guidance and no `task_status` guidance;
- generic delegated tasks still receive `task_status` guidance.

Validation:

- `vp test run apps/server/src/orchestration-v2/ProviderContinuationService.test.ts apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts` — passed after final formatting (27/27).
- Focused new tests — passed (3/3 across payload bound, retained retry byte budget, and native Die wake instruction runs).
- Server `tsc --noEmit` remains globally red from pre-existing concurrent-tree errors; filtering its diagnostics for `ProviderContinuation*` / `DelegatedCompletionWake` produced no owned-file diagnostics after the optional compatibility method fix.
- `vp fmt` and `git diff --check` passed for owned files.

## Scope held

No backend authorization policy, cancellation behavior, NativeDieIntegration production test, browser build, or canonical checkout/re-export was changed.
