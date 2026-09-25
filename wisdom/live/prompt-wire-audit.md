# Live prompt wire audit

Read-only source trace on 2026-09-25. No paid provider or microphone test.

There are two prompt files, not one shared configured-agent prompt.
- Gemini and OpenAI Realtime use src/prompts/live.md. The six tools come from src/live/orchestration.ts. Google adds NON_BLOCKING to each function declaration. OpenAI maps schemas to parameters and uses tool_choice auto.
- GPT-Live uses src/prompts/gpt-live.md, trimmed at the end. Its session.start has delegation type client and no function tools. Stop helpers named in that prompt belong to the configured agent, not the voice model.

Runtime context matters when answering what the system prompt contains. Google sends host context as user content with turnComplete false (src/live/session.ts). Realtime sends a session.update with the base prompt plus a quoted host observation in instructions (src/live/openai-session.ts). This replaces the observation suffix per flush; it is not an ever-growing prompt. GPT-Live sends observations separately (src/live/extension.ts and gpt-live-session.ts).

Initial host context comes from src/session/host.ts context(): session ID, last six bounded user/assistant texts, up to 20 local jobs, last 12 request ledger entries, request count, bounded flag, and native polling caveat. It is not the full agent prompt or full history. Later host updates and agent results also reach voice. Tool availability requires the orchestration host; standalone sessions may have no tools.

For exact wording, read the prompt files and tool declarations, not a copied snapshot here. No code changed. Values unchanged: this audit uses the existing rule to show what is real and keep one source of truth.

User asked for a line-by-line review sheet. See [prompt-line-review.md](prompt-line-review.md). It contains an explicit source snapshot, stable review labels, and open decisions. Start at L01. No prompt edits agreed or applied yet.
