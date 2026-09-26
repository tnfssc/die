# Web surface clutter audit (bounded)

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_b9632b21-a86675007a5e-task_12fc0a13
Branch: die/audit-web-projections-12fc0a13. Canonical upstream change: integrations/t3/upstream/die.patch (pinned b488c57f3f9f1688e31c53daee99e29dd1d0baa2).

## Reviewed

- Traced server Pi RPC die_task_event through PiAdapterV2.handleDieShellTaskEvent to command_execution updates and the web work timeline. Running shell commands are separate cards; completed/failed/interrupted status remains visible. Agent children deliberately skip this compatibility stream and use native task projection. Kept; do not erase failed statuses or expanded tool output.
- Traced ChatView.serverThreadProjection into ChatComposer.nativeUsage and footer output, including a hydrated/resumed thread projection. Previous footer printed “Cost own <number> · subtree <number>” even when both were identical, without a currency unit. Changed only this display projection: one cost if identical; total/this-thread breakdown if delegated usage differs. Unknown and partial remain explicit. No protocol/schema changes.
- Traced runtime_request.updated from Pi extension UI into pending user input in ChatComposer. Question attachment preparation, answer draft, pending/connecting state, errors and disable reasons retained. The web question UX is distinct from CLI /questions (and its persisted resume); no claim that CLI question commands are web UI.
- Traced Live work timeline and composer tasks badge/drawer. They preserve active/failed state and expanded diagnostic details; no safe removal established here. Live voice teardown and typed-message continuation are separate from the web native-task projection.

## Evidence and limits

- Pinned source checkout: /tmp/die-web-audit-12fc0a13 (local shared clone, not deliverable). git apply --reverse --check against integrations/t3/upstream/die.patch succeeded in that checkout after changes.
- Actual targeted web test: vp test run src/components/chat/nativeUsageCost.logic.test.ts: 7 tests passed. Covers same own/subtree, unavailable, zero-priced, partial delegated, subtree-only, same rounded amounts with different turns. Actual web tsc --noEmit exit 0; actual vp build completed in 40.61s with chunk-size warnings. Temporary build output is not a release artifact.
- No live provider/browser session was run: no before/after browser frame or provider tool transcript is claimed. The test values are fixtures, **not** actual displayed frames. This is a residual visual acceptance gate for parent. Browser gate and device/audio/permission flows unreviewed. No push/release/install.

## Kept / unreviewed / cross-boundary

Kept: error/permission wording, unresolved-question state, unknown cost, partial cost, detailed expanded tool output, task failure/interruption, the main/child cost distinction once it differs. Not reviewed end-to-end: paid provider receipts, browser pixels, T3 app authentication/session migration, native device/Live voice flows, and CLI resumed terminal frames. CLI/model-facing execute and question history surfaces belong to separate owners; do not infer their correctness from this web-only fix.
