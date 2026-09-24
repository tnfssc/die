# Live transcript handoff gap

2026-09-24: user asked to review an argument with Live. Read local wa session
history and its conversation-transcript.md with user permission. Do not copy
that private conversation into this repo.

Observed: actual voice requests reached the configured agent. User asked for
the whole voice conversation to be saved, then clarified that coding-agent
history was not the Live conversation. Agent asserted it had supplied the right
conversation, but the saved file contains agent-session messages and handed-off
user requests, not the complete Live dialogue.

Source: src/live/extension.ts Run.transcript renders a short widget (180 chars
per utterance, MAX_VISIBLE lines). It does not persist a full voice transcript
or hand that transcript to the coding agent. Thus local agent history cannot
reconstruct everything Gemini said. Do not call that export a complete Live
transcript or invent missing speech. No evidence of the entire argument is
available here. Ask for terminal scrollback/screenshot for exact missing words.

Next: design a bounded, privacy-aware Live transcript/context handoff. Keep
transcript data separate from instructions. User asked for inspection first;
no production change or new recording started. Values unchanged: truthful
history and boundary ownership already cover this failure.

## User requested repair

User now explicitly asks to fix broken on-screen transcript, missing context,
and Live refusing noncoding help such as weather. Match real die prompt voice
and values; no invented coding-only rule or claim of unlimited access.

Prompt task task_a7be92a9 owns prompt/tests, branch
die/give-live-the-die-voice-and-useful-deleg-a7be92a9, worktree
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_a7be92a9.
Transcript task task_ee2fb0c9 owns display/history/handoff/tests, branch
die/fix-live-transcript-display-and-agent-co-ee2fb0c9, worktree
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_ee2fb0c9.
Parent must integrate context contract into prompt, review privacy and bounded
retention, test actual terminal display and provider behavior, then build/install.
Nothing from these tasks installed yet.

Read src/prompts/system.md, identity.md, main-orchestrator.md: actual working
guidance says go look, share work, solve real problem. Current Live paragraph
is largely restrictions and lacks that stance. Keep tools honest without
inventing domain bans. Values unchanged; existing guidance covers this work.
