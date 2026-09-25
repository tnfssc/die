# CLI live cost work — 2026-09-25

User wants real-time live voice cost added to the CLI session cost while live runs. User explicitly clarified CLI, not web. Both Gemini and OpenAI are relevant current live providers; do not mix their wire or price semantics.

Task task_ba653160 owns implementation from root HEAD 1d251740a51e1a81c104288f1a6e41f324a543c9.
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ba653160
Branch: die/add-cli-live-voice-to-session-cost-ba653160

Need additive voice and coding totals, provider usage reconciliation without duplicates, unknown rather than free when pricing/usage missing, cheap event-driven display, persisted/resumed session accounting and tests. Label estimates. No credentialed or paid probes authorized or run.

Earlier task_3a3a6e57 was stopped after scope clarification (exit 143), before any substantive work. Do not use its web-oriented prompt.
Web port remains separate: wisdom/web/live-voice-port.md. Parent must review and integrate CLI cost independently, watching provider-file overlap with web work.

Values unchanged. Truthful UI, bounded resource use, and keeping scope clear already cover this request.

Implementation returned df922813b56cbe16561b42cf0fcebdcf952cf284. Reported 79 focused tests and typecheck pass. Independent accounting review task_d0cc3647 underway before integration. Provider-driven updates persist increments; no wall-clock estimate. Footer uses pending/incomplete indicators. Pricing details and known transcription/backend billing gaps in worker wisdom/live/cli-live-cost.md.

Parent integrated original implementation as 0f8efb3, but review found cached Gemini input full-price overcharge and missing failed Gemini-close incomplete marker. Fix task_3c1381c2 underway from that root at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3c1381c2, branch die/fix-cli-billing-review-findings-3c1381c2. Do not call accounting complete before fixes and parent verification.

## Integrated and checked

Parent integrated review fix 1b50737 after reviewing diff. Parent verification: 144 tests across cost/footer/extension/Gemini/Realtime/GPT-Live suites pass, 1021 assertions; bun run check and git diff --check pass. Cached Gemini rates not verified become unknown, not full-price charges. Unknown usage is persisted immediately; failed provider close stays incomplete. No paid/device tests run. CLI feature source integrated; packaged binary not rebuilt or installed.
