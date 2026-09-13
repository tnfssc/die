# Prompt review and shell stdin — 2026-09-12

## Current status
Historical review record. Prompt review and the closed-stdin default shipped in v0.2.6; v0.2.8 is the latest verified public release. Resume points and no-install statements below are historical; see [prompt iteration](prompt-iteration-2026-09-13.md) and [release record](releases-herdr-2026-09-13.md).

## User preferences and decisions
- Teach broad values from which the agent can exercise judgment, not a growing checklist. Generic advice is fine; arbitrary workflow restrictions such as "do next useful bit, not whole job at once" are not.
- Use simple caveman-style prompt language, normal straight quotes, no businessy phrasing. Review one line at a time with the user rather than silently rewriting remaining prompts.
- Make things work; do not build for every imagined failure. Favor fewer parts and less maintained state (database, Redis, client, anywhere).
- Assume greenfield/no backward compatibility unless user explicitly requires compatibility. Starting over, even replacing a whole implementation, is allowed when useful.
- Evidence requires looking where the answer lives, beyond the first clue. Git history alone did not explain prior prompting decisions; saved conversations mattered.

## Saved edits and review position
- src/prompts/system.md: merged responsiveness/attention; curiosity/evidence; simple designs/less state; shared work/integration; practical solutions. Opinions adds greenfield default.
- src/prompts/identity.md: You help user build software. You work inside a coding tool named "die".
- src/prompts.ts: removed hardcoded "Be concise" and "Show file paths clearly" guidelines; removed obsolete worked-example export after user removed that example.
- src/prompts/execute.md: approved opening API facts, separated launch signatures/options and launch-result facts, approved caveman handoff explanation without example or parallel edge-case sentence.
- Job API and attention-reminder wording approved and saved on September 13. Review now at Lifetimes. See prompt-iteration-2026-09-13.md for the current resume point and durable preview workflow. Remaining Lifetimes, Capabilities, History, Goal, role/mode and other prompt files are still to review.
- Prompt inventory/docs and affected assertions are synchronized. No compiled build/install/release was run for these changes.

## Shell stdin decision
User authorized CLOSED stdin by default on shell launches; closeInput:false explicitly preserves later jobs.input capability. jobs.input default stays open. Closed stdin cannot reopen for that process. Implemented in src/tasks/job-service.ts with closeStdin: params.closeInput ?? true. TaskManager and jobs.input defaults unchanged.
History research scanned 246 JSONL sessions using approximate string matching: about 128 execute payloads explicitly closed shell stdin; one confirmed successful later input interaction; September 5 eza strace confirmed read(0) wait relieved by EOF. EOF may alter output semantics, not just exit behavior (PRODUCT historical entry records an empty eza listing). Silence alone is not proof of stdin wait.

## Evidence pointers
- Main discussion: ~/.die/agent/sessions/<project-session-directory>/2026-09-12T18-55-33-487Z_01a096f9-926f-7583-887e-d2ae331ab19b.jsonl
- Original values conversation: 2026-09-05T01-04-27-472Z_01a06f18-6f50-7899-8b84-6e6bb5765319.jsonl in that same session directory. User requested values; assistant coined the original five labels.
- Stdin researcher: 2026-09-12T20-03-33-907Z_01a09737-d593-7583-887e-d2b4df1e7d39.jsonl in that directory.

## Notes handling
The checkout had no .agents/notes directory at the start of this notes update. Acquired src/memory/lock.ts acquireMemoryLock before creating these files. That protocol was later removed at the user's request; ordinary filesystem writes are now the source contract.

## Verified results
- Combined root check: 87 tests passed, 0 failed across job-service, task-manager, job-bridge, attention SDK, prompts, system-prompt, main-agent-mode SDK, instruction-continuity SDK, and subagent-extension (2026-09-12).
- bun run check and git diff --check passed.
- Initial combined prompt/integration run failed on fixtures that assumed open stdin; those read-based fixtures now explicitly use closeInput:false and pass.
- Worker reported an existing Biome import-order issue in tests/attention-sdk.test.ts; no claim of a green whole-repo lint gate.
- Notes and instructions updated; no install/release/commit. Current running binary still has the old default.

## Memory maintenance guidance
User identified that location/locking guidance did not explain maintaining notes. Approved: "Next agent not hear whole talk. Save decisions, reasons, and where work stopped. Keep notes useful as work changes. No need copy whole conversation." Added verbatim in src/prompts/memory.md, with the existing location/selective-read/locking text retained. src/memory/extension.ts embeds that Markdown for root agents (including custom bases); docs inventory updated. 17 focused memory tests, typecheck, and diff check passed. No installation.

## Memory lock removal — September 13
User explicitly requested deleting the memory lock, not exposing an acquire/withLock helper. Remove cooperative project-wide exclusion from runtime, prompts, docs, and lock-specific tests; preserve ordinary saving and consolidation/receipt behavior. No replacement concurrency system. Removal completed and verified. This supersedes earlier notes telling future agents to acquire src/memory/lock.ts. Resume the prompt review at Lifetimes.

Lock-removal verification: src/memory/lock.ts and tests/memory-lock.test.ts deleted; project/per-topic locking removed without replacement. Note saving, expected-hash checks, receipt validation, and worker/session cleanup remain. Root ran 38 focused memory/prompt tests, typecheck, diff check, and the assembled-prompt preview: all passed, no lock guidance remains. Worker also reported full suite 534 pass/14 skipped/0 fail. No install/release/commit. Current session may still carry older injected instructions until restarted.
