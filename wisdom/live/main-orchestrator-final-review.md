# Main-owner integration review

Read-only review on 2026-09-25. Draft source, not final release verdict.

**Release blockers in the reviewed working tree:**

1. **Concurrent calls can corrupt canonical history.** `src/live/main-owner.ts:397–415` records each assistant tool call before awaiting its result at `:427`; another call, typed input (`:312–316`), transcript (`:298–306`), or completion (`:327–338`) can be recorded before the first result (`:457–466`). Two overlapping tools can therefore persist `call A, call B, result B, result A`; a user utterance can also split a call/result pair. The implementation permits 16 in-flight calls (`:386`). The integration test at `tests/live-main-integration.test.ts:354–356` retries only *after* the first call finishes, so it does not cover this ordering.

2. **An unfinished input can permanently block subsequent tools.** `beginInput()` creates `pendingTranscript` (`src/live/main-owner.ts:292–296`), and `execute()` waits for it (`:375–377`). If input activity occurs but ASR never produces a final transcript, the provider’s turn-complete callback calls `owner.turnComplete()` (`src/live/extension.ts:406–410`); that method clears the draft but never resolves `pendingTranscript` (`src/live/main-owner.ts:344–348`). All later tool calls remain pending until a later final transcript or close.

I found no additional substantiated blocker in the first-turn prompt comparison, hook denial, typed-input routing, `live.stop` self-call persistence, stop-work result handling, or branch-switch guards. Those paths have targeted integration coverage; I did not invoke a provider or microphone or edit files.

Reviewed HEAD **`38cdffb247354caa9886c9b5399483bfe4d488c3`**. All four requested source files were **uncommitted modifications** at review time; tests and several other files were also modified. `LIVE-COORDINATION.md` was untracked.

## Fix integration

Fix 8e03bb7 (integrated as 2decd0a) addresses both reviewed cases. Parent read
the changes and regression assertions. Tool pairs are serialized and owner
conversation/completion records deferred until result persistence. Waiting
ASR admission gets an explicit false outcome on missing-final turn end,
interruption or close; no partial transcript is promoted to final. Focused
worker tests passed (13 integration, 24 unit); final candidate full gate pending.
