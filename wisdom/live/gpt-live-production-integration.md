# GPT-Live paired production integration (2026-09-26)

User explicitly approved paired backend delegation after reviewing support/gpt-live-explained.html. Direct-tool-only is obsolete for GPT-Live. Gemini/Realtime keep direct ownership. GPT-Live uses OpenAI client delegation, not Responses: frontend speaks/listens, the selected ordinary Pi coding session is the single task/tool authority. No additional coding session, scheduler, credentials substitution or reasoning model is created.

The frontend admits offset-only delegation metadata with a bounded provisional transcript/context snapshot; it never invents tool arguments. The canonical selected model interprets that snapshot through session.prompt, normal before-agent-start hooks, tool permissions, execute, instruction continuity, model settings and same-branch persistence. An async-local exclusive admission lets that paired backend run while unrelated ordinary text turns remain fenced. Typed input routes through the same serialized backend. Duplicate delegation IDs share their original Promise; different content under an ID is rejected. Voice closure stops new admissions, not already admitted backend work. Navigation and explicit work stop cancel foreground separately. No automatic reconnect/replay.

Frontend deltas are persisted as data-only custom live-transcript records with source, role, timeline positions, uncertainty and unverified playback. They never become authoritative completed ASR. Full canonical history remains in Pi; voice gets bounded UTF-8 JSON observations with provenance and explicit omission. Context append acknowledgment means estimated timeline delivery, not spoken playback or work success. Generic observations use null delegation IDs; only observed IDs can receive correlated commentary. Local acoustic interruption flushes voice and suppresses stale completion speech, not coding work. This heuristic is not proven VAD or a server response boundary.

The initial implementation worker called _runAgentPrompt with a string and bypassed its wrapper in tests; independent review rejected that as production proof. Correction uses real pinned Pi session.prompt and an actual execute call with a fake selected-model stream. See ../reviews/gpt-live-paired-delegation-review.md and tests/live-paired-runtime.test.ts. Do not revive the mocked private-call approach.

## Protocol and access evidence

Primary docs researched via tvly support application-chosen client backend; Responses reasoning is not required. See gpt-live-current-primary-docs.md for exact URLs and protocol limits. Canonical ~/.die/agent/auth.json had Codex OAuth, no OpenAI API-key entry; OPENAI_API_KEY was absent. The credential service deliberately requires canonical OpenAI API-key auth for Live. Zero authenticated GPT-Live calls and zero paid tokens. No device/acoustic acceptance was run. Offline proof is not live-provider acceptance.

## Durable work

Integration: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_31b7d4be
Branch: die/integrate-gpt-live-with-selected-coding--31b7d4be
All worker worktrees use that path plus -a86675007a5e- and the task suffix:
- task_82fd185c, die/gpt-live-protocol-and-paid-probe-82fd185c: docs/transport, 5af0ac15.
- task_b05986bd, die/gpt-live-canonical-backend-integration-b05986bd: initial frontend, a1263f4a; private prompt portion superseded.
- task_45ac38bd, die/gpt-paired-architecture-independent-revi-45ac38bd: architecture review, 85e9aa4.
- task_6cfff020, die/review-paired-backend-production-runtime-6cfff020: concrete runtime blockers, 71149e7.
- task_5f84c7f6, die/correct-paired-owner-ordinary-pi-runtime-5f84c7f6: canonical Pi correction, da37a65.
- task_f7c3a0d3, die/paired-async-job-continuation-acceptance-f7c3a0d3: async continuation acceptance, da58c21f.
- task_1c45a2c7, die/final-gpt-paired-integration-review-1c45a2c7: final independent review.

Parent resolves overlap with task_1a7b19db Gemini work: src/live/providers.ts, src/live/config.ts, src/live/extension.ts, tests/live-config.test.ts, tests/live-extension.test.ts and tests/no-web-voice.test.ts. Do not preserve that task's obsolete GPT blocker messages/tests when merging. This work does not depend on its Gemini changes.

## Validation

Frozen implementation 969e120: bun run check passed; matching compiled CLI build passed; full offline suite **1118 pass, 17 skip, 0 fail**, 27,976 assertions, 1,135 tests across 151 files (108.81 seconds). The 17 opt-in provider/device/LLM tests were skipped, not passed. git diff --check passed. Early broad run was invalid as final proof: CLI had not yet been built and fish PATH interpolation omitted standard tools. Tests use explicit PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:/usr/local/bin:/usr/bin:/bin and SHELL=/bin/sh. Dependencies reuse an untracked node_modules symlink; web assets copied privately from main checkout, then scripts/build.ts --reuse-web creates matching CLI. No push or release.

Parent added full production task-extension coverage beyond worker fixtures: typed session.prompt and voice delegate each run exactly once; normal execute launches an async shell, real completion notification resumes the coding backend using a custom (not user) message, and its output reaches voice context. Overlapping passive transcripts are deferred by Pi until a tool pair finishes. Real paired execute exercises live.stop then jobs.stopWork: cancellation report is delivered, execute terminates, and model continuation observes an aborted signal. New work after explicit work-stop remains possible through a generation fence. An initial stop test fake model ignored aborted signals and looped; it was corrected to honor the provider contract, not by weakening production cancellation.

Important integration corrections: no guard is installed before public session.prompt, because production input hooks must route typed input. Paired internal prompts use source extension so they do not recursively reenter that typed-input hook. The private _runAgentPrompt admission seam still rejects unrelated competing model turns. Substantive backend text is forwarded as speech-relevant commentary; private thinking is never extracted. Passive live-transcript records do not wake the coder.

Values unchanged: single ownership, whole-path proof, bounded truthful context, work/voice separation and durable handoff already express the lessons. Feature notes correct obsolete architecture assumptions rather than adding a global rule.
