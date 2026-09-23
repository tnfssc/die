# Are we actually consolidating after large tasks?

## Audit request (2026-09-23)

User explicitly authorized reviewing previous sessions to check practice, not merely instructions. This is a sampled behavioral audit, not an exhaustive review of every session. No product behavior changed.

## Evidence

- Sept 23 model persistence/dependency/release session (01a0cc8b-0d0e-70a1-b3dd-091e052a60a3, started 04:34 UTC): saved model/dependency wisdom and appended published release results to [v0.5.8](../releases/release-v058.md). Git commits 69fd0ec, 8d512d0, and f89864e corroborate capture/publication. This is useful task documentation, not evidence of a derived-values review.
- The [model follow-up](../models/last-used-model-followup.md) still ends with combined validation/release pending and an anticipated v0.5.8, even though the separate release note records successful publication. Evidence of incomplete reconciliation across notes, not failure to write notes.
- Sept 22 rename/reorganization session (01a0c965-1c62-7199-ad36-a0bc548aefae, started 13:54 UTC): explicit user request drove organization and stale terminology cleanup; release notes were updated after publication. Commit 621bb51 deliberately removed pending/index/consolidation-worker machinery in favor of direct feature wisdom. That is a requested cleanup, not proof of an automatic end-of-task habit.
- The new values/principles synthesis was explicitly requested in this current session. Its prompt and tests are still uncommitted; values documents are untracked. It has not been built/installed/released here. Prior sessions cannot demonstrate adherence to this newly introduced requirement.
- Current src/wisdom/extension.ts injects root guidance before agent start. It has no task-end consolidation hook; jobsChanged is a no-op. The new prompt asks for the review, but is not mechanical enforcement.

## Conclusion

Capture: yes in sampled tasks. Task-level synthesis: present in some major feature efforts, not consistent general practice. Consistent end-of-large-task reconciliation and values review: not established. Lack of a values edit alone is not failure—the instructions deliberately allow a justified no-change review—but these older sessions do not provide an explicit review outcome either.

Read-only reviewer task_9ec9a248 completed a sampled older-session/git audit (not all 528 pre-Sept-22 session files). Additional evidence:

- Sept 13, commit 14981b4: durable-memory journals capture decisions and some narrow lessons, but mostly accumulate chronological task state. An explicit consolidation command/test is not evidence of automatic task-end consolidation.
- Sept 18, commit 8a45421: [shared-memory value](../prompts/shared-memory-value.md) is a genuine derived principle, introduced after explicit user feedback about notes left local—not a spontaneous routine retrospective.
- Sept 19, commit 147a6d9: [resource limits](../resources/resource-limits.md) synthesizes durable resource contracts and tradeoffs; the accompanying release record remains a chronological ledger. Real feature synthesis, not general values review.
- Sept 21, commit 9abdc41: [T3 delegation status](../t3/t3-v2-delegation-status.md) consolidates ownership, API, cancellation, lifecycle, and evidence boundaries. Another strong feature synthesis.
- Sept 21, commits cccda34/0f8a32e: release records preserve evidence and procedure following explicit task instructions; not proof of a routine retrospective.

Bottom line: **note capture was common; feature consolidation happened sometimes; systematic end-of-large-task reconciliation and derived-values review was not established.** The new review habit is requested and implemented in source, but future completed tasks are needed to demonstrate adherence. No audit jobs remain.

## Consolidation outcome for this audit

Existing values 2 (evidence), 9 (deliberate changes), and 10 (resumable work) already cover the lesson; do not add another value. Recommended follow-up is a lightweight completion outcome: feature wisdom reconciled; values revised or reviewed/no change with a reason. No scheduler, queue, or mandatory reprocessing of the entire archive is needed. User has asked for assessment, so no new enforcement or install was performed.

## Authorized PR follow-up

User subsequently requested a pull request. Branch feat/derived-wisdom-values includes the lightweight completion-outcome instruction and its injection test; project-wisdom.md now references canonical guidance rather than quoting the old prompt. This does not retroactively establish historical compliance. Wisdom reconciled; existing values already cover the audit lesson, so no additional value was added.
