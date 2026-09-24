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

## Candidate implementation

Live voice transcript handoff

Old widget silently clipped each utterance to 180 characters. The coding agent saw only the newest user request and could mistake its own dialogue for the voice conversation.

Now each received bounded text segment is a session custom entry (die-live-transcript); never audio. The widget is a recent viewport with explicit clipped-line and omitted-entry labels. Model-contract final input segments stay distinct; unfinished provider text is accumulated. Model turn completion is only a boundary for unfinished output. Interrupted generated output is not claimed to have been heard. Unfinished input is partial.

The host sends the configured agent quoted transcript data alongside the latest captured user request. The request is authoritative; transcript is data, not instructions or permission to execute. Context is capped at 24k serialized characters, selecting only whole recent entries with an explicit count of omitted earlier entries. Larger conversations cannot truthfully be exported in full from this context alone; older session history requires separate retrieval. The provider caps text at 4096 characters per turn; handoff requests expire after 60 seconds. Session entries follow normal Pi session persistence and scope; there is no audio archive or cross-session transcript store.

## Parent integration

Candidate merged as 6c67c06; prompt is 0f21b16. Parent 6ec88b6 removes
per-line final/hearing diagnostic labels, shows recent tail of long text with
an explicit saved-text cue, restores 4000-char authority bound, and flushes
partial display text at model completion without granting authority.
60 focused tests/typecheck passed. Added extension persistence test for long
input, output chunks, turn boundary, stop and stale callback (task_7ab4a411).

Full history retrieval work: task_27330098, branch
die/complete-live-transcript-retrieval-and-i-27330098, worktree
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_27330098.
Real provider helpfulness check: task_6bd9f91c, branch
die/probe-live-helpfulness-with-real-gemini-6bd9f91c, worktree
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_6bd9f91c.
Both still running. Parent must integrate, align prompt with transcript access,
run full Live suite and terminal review, build/install only after validation.
No new build installed. Values unchanged: truthful history and usable UI
already cover this work.

## Scoped full-text retrieval (2026-09-24 review)

A 24k-character handoff tail is not a complete export. Host bridge now walks only
sessionManager.getBranch() (current ancestry, not the raw session JSONL with
possible sibling branches), extracts validated received-text custom entries, and
when the tail omits any entries writes a private (0700 directory, 0600 file)
JSON branch snapshot under the OS temp directory. The handoff names that path
and gives the configured agent exact Bun.file(path).json() retrieval instructions.
The snapshot is a point-in-time copy, not audio or verified heard speech; partial,
turn-boundary and interrupted statuses remain visible. Oversize valid entries are
in the snapshot, never silently skipped. Malformed entries are counted as
unreadable; no completeness claim when count is nonzero. The snapshot works for
an ephemeral session without a session file, but that does not make the session
itself durable. Temp snapshots remain after Live closes so already queued agent
requests can read them; OS temp retention applies. Do not open raw session files
as replacement: they may hold sibling branches. Tests exercise 32 entries over
24k and a single oversize entry, plus host-access handoff envelope.

Values unchanged: truthful representation (#8), safe scope (#6), and bounded
context with recoverable originals (#5) already state the relevant lessons.

Full retrieval merged as 6185646. Snapshot uses private temp directory, current
branch only, and survives voice close for accepted agent work. Review task
task_82572839 at /Users/sharath/.die/worktrees/die-f528e86af6b5-task_82572839,
branch die/review-live-transcript-and-prompt-integr-82572839, owns read-only
privacy/lifecycle/resource review. Snapshot retention/duplicate disk usage still
needs review before calling feature done.
Combined tests task_370e3a29; build/helper/onboarding task_b5664712. Provider
helpfulness task_6bd9f91c still running. Installed binary unchanged.

Review found received segments could be reordered by speaker completion and
pending text lacked its own bound. Parent now flushes the other speaker's
pending segment when new text arrives and persists long segments in 4096-char
chunks. Nothing is dropped; partial chunks do not grant handoff authority.
Tests cover interleaving and 50k nonfinal text. Updated extension expected
chunk shape; rerun task_029fc7cb.

Snapshot privacy/branch fixes: task_f33596b4, branch
die/bound-transcript-snapshot-retention-and--f33596b4, worktree
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_f33596b4.
Provider refusal correction: task_2ef62bd2, branch
die/resolve-tested-live-delegation-refusal-2ef62bd2, worktree
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_2ef62bd2.
Initial paid probe refused weather and save; do not call prompt validated.
Control must separate capture-only fixture context from actual capability.
Build prior to these follow-ups passed, but must rebuild after fixes.
No new install.

Final integrated candidate: snapshot fixes 889166c/db2ec7d, prompt correction
merged from da25dfe. Privacy: private bounded immutable snapshots, 24-hour
read window refreshed by reuse; cleanup lazy on later creation. Session text
remains in normal session history. No audio recording added.
Known limit: synthetic fake-host no-work response still elicited optimistic
waiting wording; exact result truthfulness is not fully solved by prompting.
Final prompt weather invoked agent_send once, save invoked once in worker proof.
No actual job/weather/export performed in those probes.
Final tests task_455a4b3d and build/helper/onboarding task_cd958ca9 running.
Install only after both pass; current installed build still predates this work.
Values unchanged: existing truthful UI/history, bounded resources, and go-look
principles cover the findings.

Installed candidate successfully via task_24eacd24. Installed and dist SHA256:
`deb78740acb81dac4b82388925c2570f70ea6a54549cf5806c5cd0d62b1de275`.
169 Live tests/typecheck, build/helper self-test and onboarding smoke passed.
User must fully restart. Trial: ask weather, then ask to save this new Live
conversation. Old unrecorded voice dialogue cannot be recovered retroactively.
No public release published. Real installed-host export/UI and physical audio
regression still need user validation; provider tests used fake hosts.
