# CLI live cost work — 2026-09-25

User wants real-time live voice cost added to the CLI session cost while live runs. User explicitly clarified CLI, not web. Both Gemini and OpenAI are relevant current live providers; do not mix their wire or price semantics.

Task task_ba653160 owns implementation from root HEAD 1d251740a51e1a81c104288f1a6e41f324a543c9.
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ba653160
Branch: die/add-cli-live-voice-to-session-cost-ba653160

Need additive voice and coding totals, provider usage reconciliation without duplicates, unknown rather than free when pricing/usage missing, cheap event-driven display, persisted/resumed session accounting and tests. Label estimates. No credentialed or paid probes authorized or run.

Earlier task_3a3a6e57 was stopped after scope clarification (exit 143), before any substantive work. Do not use its web-oriented prompt.
Web port remains separate: wisdom/web/live-voice-port.md. Parent must review and integrate CLI cost independently, watching provider-file overlap with web work.

Values unchanged. Truthful UI, bounded resource use, and keeping scope clear already cover this request.
