# Questions surface review

Reviewer task_ca07c996 checked the source CLI in a real PTY and the real
Pi SDK continuation path with a deterministic offline provider. Worktree:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_ca07c996
branch die/final-questions-user-and-agent-surface-r-ca07c996.

Fix 09f1978 adds unambiguous short IDs in lists and accepts them for
detail/answer/cancel/resume; agent APIs keep stable full IDs. Commands
reject ambiguous prefixes. This avoids making users copy full UUIDs.
Parent read the diff and captured terminal output; integrated as 8d9498a. Evidence in evidence/review-*.txt
is copied from the actual reviewer capture, not hand-written screenshots.

Pending status survives 50 progress updates, completion and reload.
Targeted reply saves one answer, shows saved state, and has an explicit
resume after restart. No answer ledger JSON chat bubble. Actual SDK test
proves one new turn and hidden metadata; PTY alone proves queuing only.
Corrupt storage shows /questions unavailable instead of false empty state.
Parent reviewed captured labels. Parent also replaced the command-level JSON Parse error with a plain
invalid-saved-data message and repair action; regression test passes.

Reviewer typecheck/full suite: 1154 passed, 17 skipped, zero failures.
No web, targeted voice, automatic child relay, paid/device or production
web acceptance claim. Current feature is parent CLI only.

## Lesson

User and agent surfaces are core behavior, not decoration. Real transcript
flood escaped routing tests; early question prompts advertised an unusable
answer helper. Read actual tool prompts/results and rendered UI before
release. Keep useful state and recovery visible; remove raw metadata and
extra subtitles. This helps any user-facing or model-facing change. It does
not mean stripping diagnostic detail needed for errors or expanded views.

## Parent combined capture

Actual picker PTY revealed /questions unavailable in --no-session runs.
The prior capture notes quoted just the picker and missed this surrounding
status. Parent now suppresses passive question status when no persistent
session file exists; explicit /questions still explains the requirement.
Corrupt persistent storage still shows unavailable. Regression and actual
picker PTY assert no false passive failure. Check whole frame, not only
the intended component. Evidence: artifacts/final-surface-parent.log.
