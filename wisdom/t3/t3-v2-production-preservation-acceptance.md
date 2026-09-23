# T3 v2 packaged preservation acceptance

Date: 2026-09-21

## Scope

Added `scripts/t3-v2-production/preservation-acceptance.ts`. It treats the packaged executable as a black box, copies it into a fresh private temporary root, uses fresh HOME/TMP/web/agent state, removes Node/Bun/npm from the candidate PATH, and serves a deterministic loopback OpenAI-compatible model. It does not read user state or contact a live provider. No candidate source/build files or the existing browser acceptance script were edited.

## Candidate and rerun

Final run executable SHA-256:

`f666b829d2a6b8070f20b2c7ca8561f9a1b1a029b92a5ac98b807cafb49f5c46`

Earlier hashes `cabdbde32f5bd527c4307907bf3ac1dd0e33077501ad9cb036350315eb880217` and `808a1945f2db92fa8fbe40e62d15cd2c0e83815fc4144b3261ce7f522101733c` were superseded while the browser owner rebuilt the candidate. The latest run repeated the same sole gate failure. The final hash matches `dist/t3-v2-candidate-build.json` at run time.

Rerun:

`T3_V2_ACCEPT_CANDIDATE=1 T3_V2_EXPECT_BINARY_SHA256=f666b829d2a6b8070f20b2c7ca8561f9a1b1a029b92a5ac98b807cafb49f5c46 bun scripts/t3-v2-production/preservation-acceptance.ts`

Proof: `artifacts/t3-v2-preservation-acceptance.json`.

## Observed passes

- Real packaged terminal path over the production browser WebSocket: delayed command input included an actual one-second shell delay; a non-echo output marker returned through terminal output frames.
- Terminal resize propagated: canvas changed from 300x150 to 914x279. The run captured 519 received and 542 sent WS frames.
- Execute/local-shell running lifecycle card was visible as `Running printf` while the five-second command remained alive.
- A second execute tool launched a 120-second local shell and then invoked `handoff(...)`; after 2.5 seconds the UI still showed `Running printf`. The forbidden completion marker was absent.
- Reload retained the pending shell card and exact thread route.
- Isolated deterministic provider/model/thinking settings and the preservation sentinel survived.

## Failed required gate / bug report

The run intentionally exited 1 because the completed local-shell card did not remain observable. The card was visible while running, the real job completed successfully, and the Pi session JSONL recorded both `PRESERVE_COMPLETE_START` and `PRESERVE_COMPLETE_DONE`; after completion the browser had no `Completed printf` lifecycle card. It showed only the user turn and `PRESERVE_COMPLETE_SETTLED` response. The backend also rendered `ProviderAdapterEventStreamError: Provider event stream ended unexpectedly` for that turn. This is a release/adoption blocker. No source fix was attempted.

The pending handoff text itself is not rendered, so the evidence is the deterministic execute source (shell launch followed by awaited `handoff`), the accepted `pending-tool` model request, and the still-live card. The proof does not claim a visible handoff banner.

## Explicit gaps

No packaged claim is made for manual/automatic compaction, token/cost accounting, or mode-switch history. Those were not made to pass by inference. The deterministic footer reported cost unavailable. Runtime model settings and shell-card reload history were checked; compaction/accounting were not feasible within this isolated short smoke.
