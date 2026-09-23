# T3 v2 Pi/Die local-shell card preservation fix

## Scope and diagnosis

Fixed in the non-adopted candidate source at `.cache/die-t3code-v2-production`. Did not change root/native routing.

The Pi adapter was already emitting the correct lifecycle update: both `die_task_event started` and `completed` derive the same turn-item ID, node ID, native ref (`die-shell:<taskId>`), run ID, and ordinal. The client reducer also upserts the terminal payload by that stable ID. The production disappearance was in timeline presentation after settlement: the terminal command and its enclosing `execute` carrier were folded into the generic **Worked for ...** turn summary, so the running card vanished as soon as it became terminal. Reload faithfully reconstructed that collapsed presentation.

The acceptance harness had a second, independently proven selector error: T3's canonical command lifecycle labels are **Running <program>** and **Ran <program>**, not **Completed <program>** (covered by existing `MessagesTimeline.logic.test.ts` assertions). The failed artifact contained no terminal card at all, so the selector error did not explain away the UI regression.

## Fix

- `apps/web/src/session-logic.ts`
  - Recognizes Pi/Die command items whose native ID starts with `die-shell:` and marks their work-log projection as lifecycle-preserved. This marker is reconstructed from persisted snapshot data after reload. It is not ephemeral component state.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts`
  - Excludes lifecycle-preserved shell cards from settled-turn folds.
  - Makes them a tool-group boundary, so the enclosing `execute` carrier cannot absorb them.
  - Renders the terminal card with canonical past-tense lifecycle text (for the fixture, `Ran printf`).
- `scripts/t3-v2-production/preservation-acceptance.ts`
  - Corrected the terminal selector from `Completed printf` to `Ran printf`, based on source/test evidence rather than relaxing the gate.

## Regression coverage

- `PiAdapterV2.test.ts`: asserts running -> completed uses the exact same item ID, node ID, native ref, ordinal, and run ID.
- `orchestrationV2Projection.test.ts`: applies running then terminal live events, proves one in-place visible item remains, and proves the terminal payload survives snapshot serialization/reload.
- `MessagesTimeline.logic.test.ts`:
  - proves a reloaded Pi/Die command projection reconstructs lifecycle preservation and displays `Ran printf`;
  - proves the same card remains visible from running through terminal even beside the `execute` carrier.

## Validation / handoff

Targeted suite passed: 3 files / 187 tests. `vp check` passed formatting and lint for all 5 touched candidate source/test files. These ran with dependency verification disabled (no install/version mutation). Final candidate export/build and packaged preservation acceptance remain owned by browser/build worker `task_ff1f592d`. Coordination and explicit instruction not to export the pre-fix patch were added to `wisdom/t3/t3-v2-production-design.md`.
