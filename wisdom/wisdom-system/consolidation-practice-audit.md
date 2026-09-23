# Do we clean up wisdom after big work?

## Audit request (2026-09-23)

User said to inspect old sessions and check what agents really did, not only what prompts said. This audit samples behavior. It does not read every session. No product behavior changed.

## Evidence

- Sept 23 model persistence, dependency, and release session (01a0cc8b-0d0e-70a1-b3dd-091e052a60a3, started 04:34 UTC): it saved model and dependency wisdom. It also added published release results to [v0.5.8](../releases/release-v058.md). Commits 69fd0ec, 8d512d0, and f89864e back up the capture and publication. Good task notes, but no proof of a derived-values review.
- [Model follow-up](../models/last-used-model-followup.md) still says combined checks and release are pending. It expects v0.5.8. The separate release note says publication finished. Notes were written, but were not fully brought back in sync.
- Sept 22 rename and reorganization session (01a0c965-1c62-7199-ad36-a0bc548aefae, started 13:54 UTC): user asked for organization and stale term cleanup. Release notes changed after publication. Commit 621bb51 removed pending, index, and consolidation-worker machinery. It chose direct feature wisdom instead. This cleanup was asked for. It does not prove an automatic end-of-task habit.
- User asked for the new values and lessons in this session. At audit time, its prompt and tests were not committed. Values files were untracked. It was not built, installed, or released. Old sessions cannot show that agents followed a new rule.
- src/wisdom/extension.ts adds root guidance before the agent starts. It has no task-end cleanup hook. jobsChanged does nothing. The new prompt asks for review. Code does not force it.

## Conclusion

Sampled tasks did save notes. Some big feature work did join facts into lessons. This was not a steady habit across large tasks. Regular end-of-task cleanup and values review were not established.

No values edit does not by itself mean failure. The instructions allow review with a reason for no change. But these old sessions do not record that review either.

Read-only reviewer task_9ec9a248 sampled old sessions and git history. It did not read all 528 session files from before Sept 22. It found more evidence:

- Sept 13, commit 14981b4: durable-memory journals save choices and some narrow lessons. Most entries add task state in time order. A direct consolidation command and test do not prove automatic cleanup at task end.
- Sept 18, commit 8a45421: [shared-memory value](../prompts/shared-memory-value.md) is a real derived lesson. It came after user feedback that notes stayed local. It was not an unprompted routine review.
- Sept 19, commit 147a6d9: [resource limits](../resources/resource-limits.md) joins lasting resource contracts and tradeoffs. Its release record is still a time-ordered log. This is real feature synthesis, not a broad values review.
- Sept 21, commit 9abdc41: [T3 delegation status](../t3/t3-v2-delegation-status.md) joins ownership, API, cancel, lifecycle, and evidence boundaries. This is another strong feature summary.
- Sept 21, commits cccda34 and 0f8a32e: release records keep evidence and steps because the task asked for them. They do not prove a routine review.

Bottom line: **notes were common; feature lessons happened sometimes; regular cleanup after big work and derived-values review were not established.** Source now asks for this habit. Future finished tasks must show whether agents follow it. No audit jobs remain.

## Result of this audit

Values 2 (evidence), 9 (deliberate changes), and 10 (resumable work) already hold this lesson. Do not add another value. Use a small completion result instead: feature wisdom reconciled; values changed, or reviewed with no change and a reason. No scheduler, queue, or required pass over the whole archive is needed. User asked for an assessment, so this audit added no enforcement and installed nothing.

## Approved PR follow-up

User later asked for a pull request. Branch feat/derived-wisdom-values has the small completion-result instruction and its injection test. project-wisdom.md points to the source guidance instead of quoting the old prompt. This does not change the old audit result. Wisdom was reconciled. Existing values already cover the lesson, so no value was added.
