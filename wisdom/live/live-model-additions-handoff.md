# Live model additions in progress

User asks to restore gpt-live-1 and add Gemini 3.8 Live extended thinking.
Exact Gemini model or config must come from provider evidence, not a guess.
User also approves bounded real-provider probes, then push and a new release.
Do not print credentials. Parent owns final review, integration and release.

Implementation job: task_1a7b19db (orchestrator).
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_1a7b19db
Branch: die/restore-gpt-live-and-add-gemini-live-thi-1a7b19db
Base: f7c63044c38da40d84c3a0b8d2f63e4fa8f24ea2.
Probe approval is also saved in that tree at wisdom/live/provider-probe-approval.md.

Keep Live as the main owner. Do not quietly restore a second text main.
Worker will research with tvly, build and test real provider adapters, and
return commits and limits. Research and implementation are not done yet.
Current package is 0.13.1. Read wisdom/releases/release-v0.13.1.md and
release-verification-preference.md before release. Develop pushes run the
release dry run; tag the exact passing candidate. Check publication and
assets without needless binary downloads.

Values read and unchanged so far. Existing single-owner, evidence and
durable-work values cover the plan. Recheck after review and release.

## Design discussion

User wants to understand GPT-Live before choosing architecture. No GPT-Live
architecture change or release yet. Visual explainer job task_bf7cbbfb:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_bf7cbbfb
branch die/visual-gpt-live-architecture-explainer-bf7cbbfb.
Will produce support/gpt-live-explained.html. Parent reviews and uploads to
Hoard using environment HOARD_URL, HOARD_TENANT, HOARD_TOKEN (all present).
Upload instructions: /home/tnfssc/Code/skills/hoard-upload/SKILL.md.
CLI script: /home/tnfssc/Code/host.sharath.page/cli/hoard-upload.
Never print token. Links expire and are public by link.

Explainer reviewed and integrated as a133d70. Hoard upload succeeded:
https://hoard.sharath.page/t/s/f/a87wq/gpt-live-explained.html
TTL 7 days. Static source/structure checks only; no browser visual check.
Task attention normal-color fix is running separately: task_044025a7,
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_044025a7, branch
die/use-normal-color-for-task-attention-noti-044025a7.

## GPT-Live direction approved

User approved paired reasoning backend. Prefer the selected coding-agent
model through client delegation; provider backend only if required. Earlier
direct-only restriction is superseded, not a protocol impossibility.
GPT implementation job task_31b7d4be:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_31b7d4be
branch die/integrate-gpt-live-with-selected-coding--31b7d4be
base 6474d048081f9c13fa1da4f0b9a834ad1c11e3fd.
Parent must resolve overlap with older Gemini/blocker job task_1a7b19db.
Do not integrate obsolete blocker changes over working GPT integration.
Color fix integrated 6474d04; parent reran 23 tests, all pass.

## Gemini implementation returned

Older job completed. Gemini commits aa6b1e7 and 13d6aac are candidates.
Do not cherry-pick b8a05ac/e997dba GPT blocker commits: user changed direction.
Worker reports 1109 passed, 17 skipped, typecheck/build passed. Parent has
not integrated those changes. Independent review + authorized bounded live
probe job task_9a374a40 runs from 13d6aac:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_9a374a40
branch die/review-and-live-probe-gemini-extended-th-9a374a40.
Original worker missed approval note and did not probe; do not treat its
no-paid-test restriction as current user intent.

Gemini parent integration: aa6b1e7 -> cc8f8a5, 13d6aac -> 5be46fc,
review fix 89ed545 -> 76cdd62. Config conflict kept pre-existing GPT guard
until GPT integration; do not retain it in final GPT implementation.
Parent typecheck passes. Review caught unsupported WHEN_IDLE scheduling
on extended thinking; omitted there, ordinary Gemini unchanged.
Normal Google credential resolver reported missing/canImport=true; no
paid request ran. Need user setup for real provider evidence. No keys
were printed or sought outside normal resolver.

Preflight found HTML diagram ARIA errors and Gemini test formatting.
Fixed locally; lint errors now cleared (existing warnings remain).
pnpm exists at /home/tnfssc/.local/share/mise/installs/npm-pnpm/11.27.1/bin.
Add it to PATH with Bun 1.4.2 and Node 24.21.0 for full local ci gate.
GitHub authenticated and release access ready; no push/tag yet.

Implementation is now merged locally. See wisdom/releases/release-v0.14.0.md
for current release progress; prior in-progress entries above are history.
GPT merge f519798; independent review fix 9ba3e5a. First full local gate
passed 1121 tests and 17 skips. Final fixed candidate is next.
Values rechecked: no new global rule; paired frontend still has one task
authority. Feature and release wisdom capture the concrete contracts.
