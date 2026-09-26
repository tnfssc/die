# GPT-Live input cleanup in progress

User reports internal guidance plus full delegation snapshot visible in UI
and sent to coding agent after v0.15.0. Parent reproduced code path at
src/live/extension.ts owner.delegate(prefix + JSON.stringify(snapshot)).
Earlier fix only hid passive live-transcript bubbles; did not fix this turn.

Worker task_7bbf3261:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_7bbf3261
branch die/clean-gpt-live-coding-agent-input-7bbf3261
base d9a2d32bd394faccb80da0c14e81d30eecebb1e3.
Actual user evidence summarized in worker wisdom/live/
user-delegation-message-evidence.md. Initial request already completed,
then followup, then latest "Cool, thanks. Stop" all appear in snapshot.
Need clean visible and model-facing request, not a UI-only hide. Audit
handled/unhandled speech boundary, corrections, truncation and dedup.
Keep metadata internal and history canonical; no false final-ASR claim.
No push/release/install yet authorized for this additional change.
Existing surface value applies; prior review missed GPT delegation turn
despite checking question helper and picker. Include actual GPT model
request serialization and rendered delegation turn this time.

Independent contract review b7882e2 integrated; copied into worker tree
as parent-input-contract-review.md. Regression criteria include consumed
speech across delegations, no-prefix/no-JSON actual Pi user turn, late
corrections and fresh suffix retention, no automatic work-stop for ambiguous
"thanks, stop". Metadata/history alone is not fresh authorization.
Reviewer worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6d9861c4
branch die/review-gpt-speech-consumption-and-visibl-6d9861c4.

Implemented as worker 38d38cc, integrated 493755b. Parent read actual
request builder, passive-history filter, consumption logic and evidence.
UI turn is spoken words only. Model gets words plus minimal factual
[Provisional voice transcription], no generic clarification instruction
or raw snapshot. Overlap/missing speech notes only on actual evidence.
Prior handled fragments consumed at admission, pending reserved and
released on rejection. Metadata stored internally. Legacy replay sanitized
without rewriting original disk history. Parent typecheck + 21 focused
tests including real tmux renderer pass. Worker 1175 pass/17 skips.
Parent fixed formatting in five files, now runs full gate task output
artifacts/clean-input-ci.log. No push/release/install yet.
Existing surface values still apply; feature audit/evidence updated.

Parent full local CI gate passed, including current web/CLI build,
format/lint/typecheck and standalone smoke. Final test count and log
are artifacts/clean-input-ci.log. No paid/device proof, no release yet.
