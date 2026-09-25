# Live prompts and local metadata placement

Branch: `die/consolidate-prompts-and-metadata-e23fad3b` in worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_e23fad3b`.

Moved the shared Gemini/Realtime instruction from `src/live/prompt.ts` to `src/prompts/live.md` and the separate GPT-Live instruction from its transport to `src/prompts/gpt-live.md`. Bun text imports embed both. Gemini text is byte-identical to the old template body; GPT-Live text trimmed of the Markdown final newline is byte-identical to its old wire literal. The GPT-Live protocol is still separate. Realtime's host observation prefix stays next to its runtime context assembly: it labels dynamic data, not a standalone system prompt. Updated the historical paid probe's import; older validation notes name the source file as it existed when their tests ran.

`src/live/providers.ts` now owns the Gemini ID with the existing OpenAI IDs. GPT-Live wire setup, acceptance, and error reporting use that ID. The local T3 task profile schema derives from `SUBAGENT_TYPES` without importing across the web build boundary.

Proof: compared both Markdown bodies to `git show HEAD` source text before commit; 41 targeted tests pass (Live sessions/prompt/config/schema and task lifecycle); after adding GPT-Live wire instruction assertion and Markdown newline, 12 prompt/GPT-Live tests pass. `bun run check` (asset prep and `tsc --noEmit`) and targeted Biome format pass. Schema smoke parses each local profile and rejects an unknown profile. `git diff --check` passes. Biome lint on touched files reports existing warnings, including the historical paid probe; no lint changes made to that probe beyond the import.

Remaining: no paid provider/device validation or standalone binary smoke in this placement-only change. Other audit findings are separate tasks.
