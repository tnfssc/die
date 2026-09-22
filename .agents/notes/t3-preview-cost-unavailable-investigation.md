# v0.5.5 native cost unavailable investigation (2026-09-22)

## Status

No preview cost regression confirmed. Do not interpret this as reproduction of the user's specific post-release thread: available local state predates the release. No runtime behavior has been changed; the candidate adds focused unavailable-versus-explicit-zero guards. Unknown cost remains unavailable, never a fabricated zero. No release, tag, publish, install of Die, or user database mutation was performed.

## Owned sources

- Wrapper: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c3f51d5, branch die/investigate-unavailable-native-cost-disp-7c3f51d5, starting commit dc7cd2e94336ceef5fdc6b8db2b58bf29620c0f8 (v0.5.5).
- Independent no-hardlinks clone: wrapper .cache/t3-cost-source, branch die-cost-unavailable-investigation, upstream b488c57f3f9f1688e31c53daee99e29dd1d0baa2. Canonical patch baseline commit e4eb1ade6be95e5a0c51a0cab106b7692b24ce6a; regression-test source commit 36cea885c.
- Read-only clone seed: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83/.cache/t3-preview-final-source. No shared source/cache edits.
- Dependencies installed only in this candidate, frozen lockfile and ignore-scripts, with private .cache/pnpm-store, .cache/corepack and .cache/pkg-cache. This was test dependency setup, not a product installation.
- Read the preview adoption, semantic/resource review, current-production migration, and native production accounting notes. In particular, migration proved preservation of an already-normalized USD 0.42 record, not cost backfill from historical legacy events.

## Pipeline and prior-version comparison

Pi's assistant message_end carries per-message usage; compaction_end carries additive result usage. PiAdapterV2 stores these in ownUsages and normalizes on terminal settlement. Live token/context updates and get_session_stats are deliberately not monetary inputs (session totals would double count). A running turn without finalized usage can therefore display unavailable.

normalizePiTurnTokenUsage accepts finite nonnegative input/output/cache token counts and all five cost fields (input, output, cacheRead, cacheWrite, total). The turn contract preserves input/output/cache/total USD values. provider_turn.updated flows through the application event/projection persistence path. ProjectionStore reads durable provider turns only in the requested native subagent subtree. NativeUsageAccounting deduplicates turn IDs, excludes forks, and counts missing totalCostUsd separately. No known costs means unavailable; known plus unknown turns means partial. An explicit known zero is complete. The client projection passes the report to ChatComposer, whose formatter renders the status; it does not price tokens.

Read-only audit compared previous production a9b49a7d plus its canonical patch with preview b488c57 plus its patch: PiAdapterV2.ts and NativeUsageAccounting.ts are byte-identical. The scoped subtree snapshot correction changes lookup scope, not pricing/normalization. Both remain at migration 54, with no historical legacy cost backfill.

## Pi pricing audit

Read-only inspection of installed Pi 0.87 source under /home/tnfssc/Code/die/node_modules/@earendil-works found no standard assistant usage/RPC cost-shape regression versus 0.85.1. AssistantMessage.usage still requires all five numeric cost fields. calculateCost computes all components plus total; RPC forwards message_end unchanged with JSON.stringify. Invalid nonfinite values would serialize as null and are intentionally rejected by T3.

The bundled provider catalogs contained 1,445 model records with no missing/null cost objects or rate fields. Partial modelOverrides.cost merges with base model rates; models.json validates numeric rates. Custom models with omitted cost are defaulted by Pi to four zero rates; this upstream convention is potentially misleading for unknown pricing, but would yield zero, not this unavailable label. We did not introduce or expand that fallback. Radius gateway sanitization checks only cost-object presence, so malformed gateway/extension model rates remain a possible source of null wire costs, not a demonstrated explanation of this report. No current custom/gateway provider event was reproduced.

## Sanitized local evidence (not the user's confirmed post-release thread)

Read-only audit of ~/.die/web/userdata/state.sqlite used SQLite URI mode=ro&immutable=1; logs were read without dumping credentials or user content. All available inspected production state/logs dated September 14, before the preview adoption. Immutable inspection is not a live WAL/recent-state claim.

- 276 orchestration events; 6 threads; 20 turn rows (19 completed, 1 interrupted); 4 stopped runtimes.
- 91 thread.activity-appended events, 29 context-window.updated records with token fields, 20 thread.turn-diff-completed events.
- No native provider-turn event shape or persisted monetary field in those activities.
- 165 parseable provider log records, including 20 turn.completed and 29 thread.token-usage.updated. Owner independently parsed the prefixed JSON records: 83 cost objects, all 83 with five finite nonnegative canonical fields; 55 had positive totals and 28 explicit zero totals. No invalid/null cost object was observed. These are shape/count observations, not a sum of spend (streaming/repeated records must not be double counted).

Thus historical logs had provider cost, while the legacy application activities kept token usage without monetary/native-turn records. Native accounting cannot recover that history from its current projection input. This is missing historical ingestion/backfill, not evidence that the model had unknown pricing, and not demonstrated to be a b488 regression. Do not silently sum raw logs or synthesize zero as a repair.

## Validation

Candidate commands used Node 24.15.0 and Bun 1.4.1 via explicit binary PATH; shell startup's unrelated mise trust warning did not prevent execution.

- Baseline: from apps/server, ../../node_modules/.bin/vp test run src/orchestration-v2/Adapters/PiAdapterV2.test.ts src/orchestration-v2/NativeUsageAccounting.test.ts src/orchestration-v2/ProjectionStore.test.ts: 77 passed, 3 files (.cache/cost-baseline.log).
- After two new regression guards, same command: 79 passed, 3 files (.cache/cost-regressions.log). Existing stateful Pi RPC test uses real message_end/assistant usage shape, verifies USD 0.12 reaches terminal turn; persistence suite verifies USD 0.42 reaches snapshot. New tests cover absent/null/invalid wire costs, mixed known/unknown messages, empty/legacy/running turns, and legitimate explicit zero prices.
- Candidate server ../../node_modules/.bin/tsc --noEmit: PASS (.cache/cost-server-tsc.log).
- Candidate vp fmt on both edited tests: PASS (.cache/cost-format.log).
- Contract providerRuntime.test.ts: 11 passed (.cache/cost-contracts.log).
- Client packages/client-runtime/src/state/orchestrationV2Projection.test.ts: 9 passed (.cache/cost-client-projection.log).
- Exact source gate: disposable index read-tree b488c57, apply --cached --binary web/t3.patch, diff --exit-code against candidate: PASS; no untracked source. Patch SHA256 fa9161346a2cd702854763f096fec7550037ed183722ae1798f20f9b0530e96a. Only two test files differ from the starting canonical patch.
- Initial client test command used the wrong apps/web path and found no files; this is not a passing test claim (.cache/cost-web-projection.log).
- Candidate and wrapper git diff --check: PASS.

No paid-provider request, current-thread browser reproduction, new migration run, packaged binary build, or full wrapper suite is claimed. Runtime code and version are unchanged.

## Required follow-up

Ask whether this is a new thread and whether at least one turn has finished; provider/model identifier; whether it persists after reload; and an affected thread ID/time plus actual server state-directory path (not credentials). A fresh completed Pi turn with five valid cost fields but absent durable totalCostUsd would confirm a propagation bug; a raw message missing/invalid cost would require pricing/provider investigation. Old history and truly unknown price must remain honest unavailable. Parent owns integration/release decisions.
