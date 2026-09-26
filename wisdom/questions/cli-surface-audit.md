# CLI surface audit (2026-09-26)

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_b9632b21-a86675007a5e-task_27b0d6c5
Branch: die/audit-cli-user-visible-surfaces-27b0d6c5

## Reviewed and changed

The production /questions command in src/questions/extension.ts routes through QuestionService, then Pi's notify renderer. Lists already present an unambiguous 10-character ID; detail and its saved-answer resume instruction printed the full UUID. Actual 120-column tmux frames: [before](evidence/cli-before-detail-frame.txt) and [after](evidence/cli-after-detail-frame.txt). The UUID took nearly half a line and disagreed with the list; detail now uses the same collision-aware ID, falling back to the full ID if a prefix collides. Resolution and service storage still use full IDs. A real session reload and short-ID detail lookup are covered by the TUI test; a command test checks the saved-answer recovery instruction. The 50 independent progress lines in the captures come from the test's explicit /qprogress fixture, not routine UI.

## Reviewed and kept

- Compact footer src/ui/footer.ts shows project, branch when room allows, question count/action, live state, task count, cost uncertainty, context and model. Narrow widths drop lower-priority fields; /status expands diagnostics including provider/cache/read/write and extension statuses. No cosmetic changes to incomplete billing or status uncertainty.
- Startup src/ui/startup.ts suppresses Pi promotion/skill inventory but leaves malformed-skill warnings visible. [Actual startup frame](evidence/cli-startup-frame.txt) includes the diagnostic and a tmux extended-key warning. /skill autocomplete remains available (tests/startup-tui.test.ts). Warning is operational, not promotional clutter.
- Live setup src/live/setup.ts and src/live/extension.ts retain explicit API-key and permissions guidance, provider/model distinction, stop-incomplete warning, local-terminal restriction and non-cancellation statement. Real Live picker TUI test showed provider selection and /live status identifying the voice model separately from coding model. The wording is needed to avoid conflating them. No microphone/provider acceptance inferred from the offline picker.
- Questions preserve requester, choices, blocked checkpoint, delivery uncertainty, corruption warning, and no-persistent-session explanation. The footer's passive /questions-unavailable is suppressed for no-history sessions, but actual storage errors remain visible. Answer state and cancellation remain distinguishable.

## Not reviewed / limits

This is the CLI/UI ownership slice only; web, background jobs/attention, tool definitions and the separate history-banner files were not modified. No model-facing tool contract changes. Pi's full interactive command palette, real paid voice transport/audio hardware, tiny-terminal snapshots beyond existing tests, and multilingual layouts were not independently verified. Typed command detail and resumed session were exercised in tmux; Live picker/status was exercised offline, not equated with typed turn rendering. The historical Live model-input evidence describes a separate production provider bridge and does not establish this change's behavior.

Checks: bun run check; matching CLI build with scripts/build.ts --reuse-web using an existing web runtime (no web changes); bun test tests/questions-extension.test.ts tests/questions-tui.test.ts (8 pass); bun test tests/startup-tui.test.ts tests/live-picker-tui.test.ts (3 pass); final resumed TUI rerun passed. Full suite not run in this worktree. No push/release/install.
