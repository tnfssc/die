# v0.15.0 release work

User approved release after persistent questions, GPT transcript/audio fixes
and unified Live picker. Explicit priority: user and agent surfaces, clear
labels and useful state without unnecessary subtitles or metadata.

Current integration: questions merge e6242a7; unified picker cdc7723;
transcript 2af554c/867954c/1a7a3fa; audio 82cacb0/a53cb01/2b58227.
Question final surface reviewer task_ca07c996 (worktree recorded in
questions handoff) and actual picker UI verifier task_e904101b still run.
Picker verifier: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e904101b,
branch die/verify-actual-unified-picker-ui-e904101b.

Public scope/limits: support/release-v0.15.0.md. Parent CLI questions only.
No paid/device verification; native seam defect proven offline, user
crackling cause still unconfirmed. No candidate push/tag/install yet.

Full local gate pending, then exact-SHA hosted CI and release dry run.
Tag only passing candidate. Publication proof checks assets/metadata,
not redundant binary downloads.

First gate stopped during web cache preparation: cached tree still had
previous die.patch, so neither apply nor reverse-check of new patch
matched. No source bug hidden. Verified old patch reverses cleanly, reversed
only that patch, applied current patch with --check. Ignored dependencies
kept. Gate rerun now uses current web regression patch.

First full current-cache gate passed: 1151 passed, 17 opt-in skips, zero
failures, web/build/smoke passed. Final question review integrated 8d9498a
short-ID UX and actual helper surface coverage. Parent added readable
corrupt-data error with a test. Final gate must include these changes.
Values #8 refined from explicit user direction: rendered user surfaces
and actual agent prompts/results are core behavior, not decoration.
Linked final-surface-review.md holds concrete evidence and boundaries.

Actual picker PTY verifier ff59615 integrated as 85ff530: all five models
fit 80/120 columns, provider setup Done-only, no voice start. Parent rerun
caught irrelevant /questions unavailable in --no-session fixture. Fixed
passive status for no-history sessions, kept explicit command errors and
corrupt-ledger unavailable status. Actual PTY regression added. Final
frozen gate must include it. Source CLI visual tests use fake credentials
and audio; no provider access implied.
