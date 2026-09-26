# Persistent questions implementation in progress

User approved proposal and suggests /questions. Parent chose full list
command plus compact discoverable pending indicator near input. Questions
can be asked while independent work continues; explicitly show blocked work.

Implementation orchestrator task_ac81ff3b:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac81ff3b
branch die/implement-persistent-async-questions-and-ac81ff3b
base 5b8abe612caeb9272c27602e45ad01701a0cec34.
Read proposal, research and architecture survey in this folder. Runtime
implementation is now authorized, but no push/release/install yet.

Need real TUI proof, durable session/branch ownership, explicit targeted
answers, normal styling, no focus theft, duplicate asks or auto-answers.
Unsupported native child resumption stays honest; no shell-stdin shortcut.
Voice provisional transcripts are not authoritative targeted answers.
Web support must match actual implemented/tested projection, not claims.

Base includes unreleased GPT transcript flood and native packet-tail fix.
Do not drop them. Their handoffs remain in wisdom/live. Parent must review
combined changes and tests before publication or installation.

Visibility value was already amended during research. Review again when
implementation is done; do not add redundant values.

## Updated user direction

Release approved when finished. Explicitly prioritize user and agent
surfaces; no unnecessary subtitles/clutter. Details and review checklist
in user-surface-release-direction.md (also copied into worker tree).
Parent must run dedicated combined surface review before release.

Dedicated surface review task_91857e74:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_91857e74
branch die/review-user-and-agent-surfaces-for-next--91857e74.
It reviews current evidence and labels unfinished implementation; final
frozen-source acceptance still needed before release.

Surface snapshot review integrated from 4a7584d; see surface-review.md.
Copy sent to implementation tree as parent-surface-review.md. Findings
are pending, not proof current draft still has them: raw answer JSON in
visible chat, questions.answer advertised though rejected, resume missing
from help, failed refresh clearing badge, ask/block semantics scope.
Parent must verify corrections on frozen source, real PTY and actual
model-facing outputs before release. No final approval yet.

Implementation returned and merged as e6242a7 from tip 64dd77c. Worker
full gate: 1151 passed, 17 skipped, zero failures. Parent-CLI scope only:
no web projection, child in-place continuation or targeted voice replies.
Final frozen-source surface reviewer task_ca07c996:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_ca07c996
branch die/final-questions-user-and-agent-surface-r-ca07c996.
It checks actual terminal and model-facing surfaces plus runtime/races.
Await review and model picker task_a3d8cf19, combine, then release gate.
