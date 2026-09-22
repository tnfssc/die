# T3 v2 production accounting / Herdr / liveness preservation

## Delivered

### Native T3 usage ownership

Added candidate source and focused tests in `.cache/die-t3code-v2-production`:

- `apps/server/src/orchestration-v2/NativeUsageAccounting.ts`
- `apps/server/src/orchestration-v2/NativeUsageAccounting.test.ts`

`nativeThreadUsageReport` reports separately labeled `own` and `subtree` totals. It follows only durable `relationshipToParent === "subagent"` lineage (never forks), consumes only normalized per-provider-turn `usageScope: "main_agent"` records, and deduplicates by durable provider turn id. Consequently:

- nested descendants contribute their own usage once;
- a parent record with `hasSubagents` is not treated as an aggregate and is not multiplied;
- retry attempts and compaction calls are additive own usage inside their provider turn, while distinct provider turns are counted once;
- replay/resume/duplicate terminal records with the same provider-turn id count once;
- a later complete record wins over a duplicate partial record;
- failed/cancelled turns retain partial usage and missing usage remains explicitly counted as unavailable.

The production path now retains provider-reported monetary usage. Optional per-turn USD component fields on `TurnTokenUsage` remain backward-compatible with old stored events. PiAdapterV2 adds each completed assistant attempt and compaction result's own `usage.cost` exactly once into the provider turn; it never reads the cumulative `get_session_stats` snapshot for spend and never guesses pricing. Failed/interrupted turns retain observed usage as partial, while turns or legacy records without a provider cost remain explicitly unavailable.

`ProjectionStore.getThreadSnapshot` and its bounded variant now invoke `nativeThreadUsageReport` over durable thread lineage/provider turns and project the result through the existing authenticated read-only thread-detail HTTP boundary. The web composer renders distinctly labeled `Cost own` and `subtree` values, including partial/unavailable state. Root and child snapshots each expose their own/subtree boundary, and fork lineage is excluded. The existing transcript-scanned Die usage summary and local CLI session-cost totals are unchanged.

### Herdr reporter authority

Added a real fake-Unix-socket regression in `tests/herdr-agent-state.test.ts`: a TUI root owns the reporter while a separate native-style `mode: "rpc"` Die process inherits the same Herdr environment at depth zero. The RPC child emits no session/state/release frame, does not steal root authority, and the root continues reporting and performs the sole release. This directly protects the existing TUI-only runtime guard.

No Herdr source behavior changed; the existing guard was already correct.

### Parent liveness / transfer settlement

The accounting candidate test exercises the production `delegatedTaskProgress` projection:

1. running descendant => `waiting_for_children`;
2. child terminal but completion transfer `pending` => still `waiting_for_children`;
3. transfer `acknowledged` => `result_available` (idle edge);
4. reconnect replay of the acknowledged projection => no second state edge.

The pre-existing `SubagentProjection.test.ts` also covers pending/claimed versus acknowledged/delivered/disposed transfer states and background tasks. No parallel liveness state machine was introduced.

### Native provider session persistence preservation

The focused Pi adapter suite confirms the existing production path remains intact: persisted `sessionFile` identity (not display UUID), separate native-session message identity, resume/switch behavior, manual and automatic compaction lifecycle/continuation, final usage refresh, and separate compaction identities between threads. Native children remain distinct backend provider sessions; this work adds no root-written child transcript files.

Die CLI local JSONL session-cost aggregation was not changed. Its focused suites still prove recursive exactly-once descendant cost handling, resume/append, failure/kill partial usage, failed compaction dedupe, cycle/fork exclusion, and TUI resume updates.

## Verification (private `TMPDIR=/var/tmp`, no credentials or live state)

- Candidate `NativeUsageAccounting.test.ts` + production `ProjectionStore.test.ts`: **22 passed / 0 failed**; the snapshot test asserts persisted provider cost reaches `projection.nativeUsage`.
- Candidate `PiAdapterV2.test.ts` adds additive assistant/compaction monetary normalization and a finalized production provider-turn assertion. The pure monetary normalization focus passed **1 / 1**; the stateful adapter focus timed out while concurrent queue/resource edits were active, so it is not claimed as passing here.
- Contract compatibility: `providerRuntime.test.ts` **11 passed / 0 failed**; legacy cost-less usage still decodes and provider USD fields round-trip.
- Client projection preservation: `orchestrationV2Projection.test.ts` **8 passed / 0 failed**.
- Die `herdr-agent-state.test.ts`: **12 passed / 0 failed**.
- Die session-cost focused suites: **10 passed / 0 failed**.
- Candidate formatter passed for both new files; root Biome passed after formatting; `git diff --check` passed.
- Contracts and web typechecks pass. Candidate server typecheck exits nonzero only from concurrently owned `NativeDieIntegration.production.test.ts`; there are no accounting/Pi/projection/UI diagnostics in `/var/tmp/account-server-tsc.log`.

## Boundaries

I did not touch backend policy/profile files, root JobService/execute identity, provider queue/release ownership, or Pi selection policy. I did not export or adopt a canonical patch.
