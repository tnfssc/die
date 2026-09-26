# Retain GPT speech before delegation

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_c71a0637
Branch: die/fix-lost-speech-wrapper-and-premature-tr-c71a0637
Base: c08e1714472a26a3bc4db92f03ea238366e996c9

The reported “Earlier speech was not retained; this is the captured portion:” was not spoken by the user. The request builder manufactured it after a 32-fragment / 6000-serialized-character bridge limit or its own second 4096-character slice. Tiny provider deltas made the fragment count a much smaller speech budget than it looked. Whitespace-only deltas were also discarded, which could join words incorrectly.

The bridge now retains at most 64 KiB of serialized UTF-8 fragment evidence (including timing/JSON overhead), rather than counting deltas as turns. The byte accounting is conservative by one comma. At 200 ms cadence, ordinary minute-long requests fit without coalescing. There is no invented ASR finalization or replacement rule. Arrival order, timing, late corrections, admission consumption and ID deduplication stay intact. Empty deltas are ignored; whitespace deltas are retained. The request builder no longer slices retained words a second time. Overlap stays as separate alternatives with a model-context fact, not a synthesized sentence in user speech.

Actual loss does not dispatch a suffix. It returns separate feedback: “I couldn't retain the whole request. Please repeat it.” The incomplete attempt is retired so a fresh repeat can recover. An old offset cannot acknowledge newer loss or unlock a retained suffix. Evicted pending fragments remain unresolved until admission settles: another delegation cannot dispatch through that uncertainty, and receives separate “still checking whether the earlier request was accepted” feedback. Admission makes the old evidence handled; failed admission marks it missing. The extension now forwards this targeted feedback rather than replacing it with generic clarification.

User messages contain speech only, both in ordinary Pi history/TUI and the actual serialized coding-model request. Source/overlap facts are a separate non-displayed custom context record. Pi serializes that context as a separate user-role message, not as words appended to the speech turn. This preserves provisional status without presenting metadata as spoken words. Old audited loss wrappers and legacy snapshots cannot replay their partial suffix as an actionable user message; the loss fact is separate context. Historical disk/TUI history is not rewritten. Repeated legacy snapshots do not invent a repeated-delegation user sentence.

## Evidence

- [Actual serialized model messages](evidence/retained-gpt-model-messages.json): real production Pi owner/extension with offline mocked provider. A 68-character request arrives one character per 200 ms fragment, then silence/delegation, pending eviction, genuine overflow, a clean followup, and a late correction immediately before another followup. Overflow starts no model turn. Later typed input remains plain typed input.
- [Real tmux Pi pane](evidence/retained-gpt-tmux-pane.txt): bridge/request builder to paired owner to ordinary Pi renderer. Genuine overflow is refused before a >32-fragment fresh repeat. No loss prefix, overlap prefix or partial request bubble.
- Unit regressions cover 100 chunks / >4096 characters, UTF-8 byte overflow including one oversized fragment, whitespace boundaries, silence/followups, consumed evidence eviction, late correction, dedup, admission failure, unresolved pending eviction and stale offsets after loss.

To reproduce, use Bun 1.4.2 on PATH. Validation used a temporary node_modules symlink to /home/tnfssc/Code/die/node_modules; it was removed after testing. Recreate that symlink or install locked dependencies to rerun. Use an isolated TMPDIR for the broad Live suite; the shared /tmp transcript snapshot quota is already exhausted. No shared snapshots were deleted.

Commands:
- DIE_LIVE_INPUT_CAPTURE=wisdom/live/evidence/retained-gpt-model-messages.json bun test tests/live-main-integration.test.ts -t 'one clean provisional request'
- DIE_LIVE_TUI_CAPTURE=wisdom/live/evidence/retained-gpt-tmux-pane.txt bun test tests/live-spoken-tui.test.ts
- TMPDIR=<fresh temporary test directory> bun test tests/gpt-live*.test.ts tests/live-*.test.ts
- bun run check

Initial validation mistakes are not claimed as passes: fish expanded a constructed PATH incorrectly, breaking shell fixture utilities; fixed with an explicit PATH. A non-isolated broad run had four transcript snapshot quota failures, unrelated to retained GPT input. Focused model capture and TUI capture pass offline. No microphone, acoustic, paid-provider or ASR-quality proof; no keys were used beyond the offline dummy key. No push, release or install. Parent review is required before release.

## Review and overlaps

Independent semantic review task_63c071fb identified pending-eviction admission uncertainty; the new gate and admitted/rejected tests address it. Its durable workspace is /home/tnfssc/.die/worktrees/die-a86675007a5e-task_c71a0637-a86675007a5e-task_63c071fb, branch die/independent-retention-semantic-review-63c071fb. Final diff review task_d65a614e uses /home/tnfssc/.die/worktrees/die-a86675007a5e-task_c71a0637-a86675007a5e-task_d65a614e, branch die/review-retention-fix-diff-d65a614e. Both are read-only review worktrees.

Overlap with broad clutter task_b9632b21: passive-history.ts and its context projection tests, plus the one-line extension clarification forwarding change and model integration test. Preserve separate overlap/provisional facts and loss refusal when integrating. No audio capture/playback caps or realtime-cap task_0e7084af files changed.

Values unchanged. Existing values already require whole-path proof, honest loss, clean surfaces and simple bounded state. This note corrects the local conclusions in clean-gpt-model-input-evidence.md: the previous small-count retention and injected loss prose were not acceptable even though those earlier tests passed.

Final review found two concrete gaps: silent pending-eviction refusal and a late correction concatenated with a later followup. Pending uncertainty now gets targeted wait/retry feedback, tested through the actual extension. A bounded admitted-timing watermark marks earlier-timestamp speech as late/overlapping; the correction and new followup remain separated by a newline with separate uncertainty context. We intentionally do not discard the correction or invent a final-ASR replacement rule. The review suggestion to make the followup contain only new speech would lose that unhandled correction; parent should review this explicit choice. Added focused regression for a correction arriving immediately before a distinct followup.

Final validation: isolated GPT/Live suite **321 pass, 3 skip, 0 fail**, 22,474 assertions across 45 files. The three paid-provider tests were skipped, not passed. Final TypeScript check and git diff --check pass. Actual serialized-message regression passes 54 assertions; real tmux regression passes 11 assertions. This is focused Live coverage, not a claim of a full-repository or acoustic test run.
