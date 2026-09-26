# v0.15.2 candidate (not published)

User authorized integration and patch preparation; parent owns publication after
exact-SHA hosted gates. No push, tag, release, or local installation performed here.

## Integration and scope

Integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_252eb36d
Branch: die/integrate-reviewed-branches-and-prepare--252eb36d
Starting tip: 509d2a4a1ec9248be85f92740abd5ab6b77d61de. Parent had already made
normal merges a0ad19c (buffered Live tip 020f3d5) and 509d2a4 (research tip be2fe08)
before delegating; retained those merges and ancestry, did not recreate them.
The Live merge adds its replay regression after develop's 50-second streaming
regression; newer audio, retention and user/agent surface fixes remain intact.

All post-v0.15.1 production fixes are covered by [support notes](../../support/release-v0.15.2.md):
streamed audio duration without weakening packet/queue bounds; bounded chunked GPT
speech retention and honest refusal on missing speech; separate provisional/overlap
model facts; startup buffered reply speech flag; transcript banner removal; short
question detail IDs; deduplicated web cost summary; validated goal transport marker
removal before model dispatch. Source, serialized model-message and PTY tests cover
actual surfaces, not just helper strings. Research adds only experiments and wisdom,
not SSH transport, remote service, credentials policy or restart recovery.

Historical remote macOS handoff/base/PR-access metadata is now explicitly dated
provenance, not current integration guidance. Older review notes record earlier
review-only authorization; this candidate follows the user's newer merge/release
instruction. No additional UI warnings or metadata were added.

## Validation

Full local Linux gate passed (exit 0) with explicit installed binaries (no mise shim):
Bun 1.4.2, Node 24.21.0, pnpm 11.27.1; SHELL=/bin/sh. Log:
artifacts/release-v0.15.2-ci.log; per-step logs artifacts/ci/ in the integration worktree.
The gate tested the v0.15.2 package/production tree at 22db8b8; final changes only
record these results and the review. Results:
- Locked install, format, lint, typecheck, fresh CLI/web build and offline default
  OpenAI source/compiled transport checks passed. Lint/build warnings remain
  nonfatal; they are not reported as warning-free.
- Web backend: 260 tests / 16 files; model behavior: 158 / 2; contracts: 26 / 3;
  client projection: 9 / 1. All passed.
- Deterministic suite: 1195 passed, 17 opt-in skipped, 0 failed; 28663 assertions
  across 166 files. Standalone smoke passed.

Initial shell startup emits an untrusted
mise config warning; actual gate PATH names installed tool directories directly.

Independent read-only whole-diff review: task_08183d98,
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_252eb36d-a86675007a5e-task_08183d98,
branch die/independent-integrated-release-review-08183d98. No confirmed production
correctness blocker; 118 focused tests passed across eight files including both
merged Live regressions. Parent
[bounded review](../reviews/merged-live-remote-final-review.md) also retained from
b12d276 (note only; equivalent historical wording already integrated here).
Whole-range diff whitespace check flags only blank lines at EOF in two existing
raw terminal capture files; retained the evidence rather than altering frames.
Candidate-only diff whitespace check passes. The untracked
wisdom/reviews/parent-release-update.md is a parent-owned coordination message;
left untouched and not committed.

Both integrated local remote-workspace demos and strict direct experiment typecheck
passed. The actual-agent demo used the built v0.15.2 binary and three fake-model
turns; result PASS. Logs: artifacts/release-v0.15.2-research.log and
artifacts/release-v0.15.2-rpc-research.log.

No real microphone/speaker, acoustic listening, ASR-quality, paid provider or actual
SSH link-loss acceptance. A provider commentary request does not establish audible
playback. Offline remote demos establish same-machine placement/ownership only.
Hosted Linux/macOS and release dry-run gates must pass at the exact candidate SHA
before parent tags/publishes. After publication check release/assets exist; do not
download binaries just to repeat CI hashes (release-verification-preference.md).

## Wisdom and values

Read values, both branch reviews, pushed-branches handoff, v0.15.1 release evidence
and verification preference. Updated remote historical metadata and this release
handoff; added concise support notes. Values unchanged: whole-path proof, truthful
limits, bounded state, simple ownership and clean user/agent surfaces already cover
the repeated lessons. No new blanket caveat or value is warranted.
