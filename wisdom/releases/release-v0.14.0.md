# v0.14.0 released

Published https://github.com/tnfssc/die/releases/tag/v0.14.0.
Tag and tested candidate: 3101df0787bc7e2217b18f28cccda9c1e4767836.
User approved push, release and bounded real provider probes.

## Scope

GPT-Live uses the selected coding session through client delegation. One
canonical task authority owns tools; voice is a paired frontend. Gemini
Extended Thinking is selectable; ordinary Gemini remains default. Task
attention notices now use normal terminal color. Public notes:
[support release notes](../../support/release-v0.14.0.md).

## Proof

- Final local full gate passed: 1122 tests, 17 opt-in skips, zero failures;
  27925 assertions across 151 files. Fresh CLI/web build, web suites,
  format/lint/typecheck and standalone smoke passed. Bun 1.4.2, Node
  24.21.0, pnpm 11.27.1, SHELL=/bin/sh. Log:
  artifacts/live-model-release-ci-final.log.
- Hosted Linux/macOS CI passed:
  https://github.com/tnfssc/die/actions/runs/36227548910
- Exact-SHA release dry run passed:
  https://github.com/tnfssc/die/actions/runs/36227548901
- Tag publication passed:
  https://github.com/tnfssc/die/actions/runs/36228138546
- GitHub latest is v0.14.0, not draft or prerelease. All 12 expected assets
  exist and are nonempty. Metadata: [publication](v0.14.0-publication.json).
  No redundant published-binary downloads or hash rechecks. No local install.

Canonical Google/OpenAI voice keys were missing. Approved real probes could
not run. Codex OAuth is not an OpenAI voice key. Paid provider access, audio
quality and device acceptance remain unverified; opt-in skips are not passes.

## Review and fixes

GPT tip acae36b and Gemini changes merged as f519798. Conflicts preserve
both Gemini models, working GPT selection, provider switch memory and both
regression suites. Do not restore obsolete GPT direct-owner-only blockers:
user explicitly approved the paired backend architecture.

Gemini review caught unsupported WHEN_IDLE tool-response scheduling for
Extended Thinking; 76cdd62 omits it only for that model. Combined review
found prompt options left installed when paired voice stops without a coder
turn. Fix e9dd7c3 integrated as 9ba3e5a. Final gate includes this fix.
First pre-fix gate also passed, but is not the final candidate evidence.

Combined reviewer worktree:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_2e733e5c
Branch die/review-combined-live-release-integration-2e733e5c.
Full worktree and earlier decisions:
[handoff](../live/live-model-additions-handoff.md),
[GPT production](../live/gpt-live-production-integration.md),
[Gemini thinking](../live/gemini-3.8-extended-thinking.md).

## Wisdom and values

Feature and release wisdom now records paired ownership, provider evidence,
review fixes and acceptance limits. Values reviewed after broad review and
release; unchanged. One task authority can have a paired voice frontend.
Existing whole-path proof and honest evidence cover the lessons. No new
blanket direct-tool-only rule is warranted.

Post-release evidence commit uses [skip ci]. Tested tag stays at the exact
candidate SHA above.
