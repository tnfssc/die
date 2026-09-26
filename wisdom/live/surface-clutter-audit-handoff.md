# User and agent surface clutter audit

User asks to remove redundant Live history banner and check for other
unnecessary text visible in UI or sent to agents. This follows v0.15.1
GPT input cleanup. Audit real render/model paths and replay, not grep only.
Keep useful errors, pending state, permissions, loss/uncertainty and expanded
diagnostics. Do not replace clutter with new subtitles.

Banner-only task_1214543b:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_1214543b
branch die/remove-redundant-live-history-banner-1214543b.
Broad audit orchestrator task_b9632b21:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_b9632b21
branch die/audit-and-clean-user-and-agent-surface-c-b9632b21.
Both base eb56ca26d57e07e9e844db83401472abdbef8581.
Broad worker avoids banner file overlap, delegates surface areas and
returns concrete fixes, captures/tests, inventory/limits and commits.
Parent integrates/reviews. No new release/install requested yet.

Values already cover clean surfaces and truthful state. Evaluate again
when findings return; do not create redundant global rules.

Banner fix aed9c87 integrated c08e171. Parent typecheck and 9 transcript
tests pass; worker could not run Bun through its mise wrapper. History
and four content rows preserved. Broad audit still running.

Original audit worker stalled after integrating three commits, stopped
with exit143. Preserved f6812df web identical cost dedup,0c0d8ea question
detail short IDs,fdcc8e5 goal transport marker stripping. Not yet in parent.
Replacement finalizer task_e457c60d:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_e457c60d
branch die/complete-surface-audit-and-review-combin-e457c60d
base2f59f92. Reviews/applies those commits, combines newer fixes, records
actual audit scope/evidence and unreviewed surfaces. Parent then full gate.

Audit review complete, integrated 7d2fc63/a564175/1936347/70ee999.
Parent typecheck and goal-marker/questions tests pass. Full local gate
now artifacts/surface-audio-retention-ci.log includes speech retention,
48s cap removal and banner. Updated cached web tree by checked reverse
of exact previous patch and checked current apply; no files reset.
Actual audit scope/intentional kept info/limits in surface-clutter-audit.md.
No exhaustive cleanliness or browser/device acceptance claim.

Parent combined full gate passed1194 tests/17 opt-in skips/zero failures.
Fresh CLI/web build, web suites, typecheck/format/lint/smoke pass. See
surface-clutter-audit.md for scope and limits. Not pushed/released yet.
