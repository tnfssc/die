# Questions that stay until dealt with

Research and design only. Checked 2026-09-26 against die base `2b58227be64c72f83c4c9050a4e668e2e4eabbad`. No tool or UI was implemented. See [Codex evidence](codex-source-research.md) and [die source survey](die-architecture-survey.md). Proposed names and UI below are not existing APIs or Codex claims.

## Problem and recommendation

The user's GPT Live crackle clarification disappeared behind later progress messages. This is a user report, not a reproduced audio/UI test. The flaw is not that the agent kept doing useful work. It is that a question existed only as chat text.

Keep a small, persistent **Questions** area beside the input. Asking adds a record there and returns its ID immediately. Work that does not need the answer can continue. When the answer becomes necessary, mark the affected work as waiting on that question. Make that change prominent without asking the same question again. A chat message alone, a timer reminder, or a blocking modal alone does not solve this.

Example (proposed UI, not a screenshot):

> **1 question · work can continue**  Q1 — Does the crackle happen during playback, recording, or both?  [Reply] [Cancel]
>
> Later, in the same place: **Q1 · waiting on you** — Playback diagnosis cannot choose its next test. Source research is still running.  [Reply] [Cancel]

Do not claim the whole session is blocked when one task is blocked. Do not claim work is running just because a question is open.

## What exists today

Codex does have a sourced asynchronous question path: catalog-gated `request_user_input_async` posts structured questions and returns `{"accepted":true}` so the turn can continue. The older `request_user_input` waits for a reply. The official September 3, 2026 release note and pinned handler/test establish this distinction. They do **not** establish the recalled later prominent blocked prompt or persistence after the turn; one September desktop issue reports a question disappearing. The companion [source note](codex-source-research.md) has exact links, dates, synchronous TUI fixtures, and the no-desktop-test limitation. Use the async idea, not an invented Codex guarantee.

In die, inspected execute helpers have `handoff()`, job control, history, goals, and Live stop, but no found correlated answer-returning question operation. Handoff ends that execution while background jobs may continue. Existing attention tracks jobs, not unanswered questions. This is a scoped finding: the pinned T3 patch contains a provider `user_input_request` fixture, so it would be wrong to claim no question support anywhere in the wider stack. That fixture alone is not an exposed die question contract. A future implementation should inspect the actual pinned upstream request/input handler before adding parallel UI machinery.

Goal mode already has durable branch-owned records and a `blocked` reason, but only one goal; it is not a multi-question inbox. Its handoff hook records running job IDs as waiting, and its reconciliation reactivates when a job finishes or pauses when the process no longer knows a job (`src/goals/extension.ts:135-150,232-242`; `src/goals/store.ts`). Reuse the persistence pattern, not that job-completion rule for question resolution. The web and CLI need a shared question projection; a custom session record alone is not a web UI change.

## One record, separate work status

A question needs an ID, its owning session/branch, requesting task, text, a short reason, creation time, state, optional answer, and the affected task IDs. Store enough answer provenance to distinguish a user submission from quoted text or an agent suggestion. Record revisions/transitions so restart can reconstruct state. No general workflow engine, new broker, task dependency graph, or timers are needed.

Question states:

- **Pending:** no accepted answer; it may or may not block work.
- **Answered:** the user's reply is saved, but its owner has not yet dealt with it. Show “answer saved; waiting for task,” not “resumed.”
- **Resolved:** the owner used the answer, or explicitly closed the question as no longer needed. Save the reason. This does not mean the task itself succeeded.
- **Canceled:** the user withdrew the request to answer, or the owner canceled the question. Save who and why. This is not an answer and not permission to guess.
- **Expired:** the question is no longer valid (for example its owning task was replaced). Give the concrete reason. No short automatic timeout in version one; navigation or process restart alone must not expire it.

Keep task state separate: working, waiting on Q1, stopped, finished, or unavailable. An answer to Q1 only releases Q1's blocker; another missing answer or a user stop still prevents resumption. Canceling a question does not silently cancel a shell job or resume dependent work. Its owner must close, revise, or keep that work blocked with an honest reason. A changed material question gets a new ID and an explicit replacement link; never reinterpret an old answer under new wording.

## Reply authority and ownership

The session runtime owns question state. CLI, web, and Live submit commands to that owner and render its result. They must not maintain competing authoritative queues. Child agents can request questions; that does not make them authorized to answer their own questions as the user.

Reply carries question ID and version, text/selected choice, source surface, and the user event/turn reference. Validate owning session and active question at submission. A tool result, webpage, worker message, or inferred preference is not a user answer. The parent may resolve a question because research made it unnecessary; that is an owner resolution with a reason, not a fabricated user reply.

Accept one reply for one question revision. Retry the same submission safely; reject a conflicting second submission with the current state visible. This prevents two connected surfaces from silently overwriting one another. Deliberate correction is a new explicit user action. Don't promise authentication stronger than the host already has: a surface/event reference is provenance, not proof of a distinct human identity.

## Asking and continuing

Use two conceptual operations: “record this question” and “this work now needs its answer.” Exact API names can wait. Posting returns an ID, not a promise that holds an execute call open. Marking work blocked yields its next turn with a saved checkpoint: what remains, what depends on the reply, and what can continue. Code after `handoff()` still does not run. A later answer starts a new agent turn; it does not revive a JavaScript stack or replay earlier side effects.

Foreground: post Q1, do independent investigation, then yield if there is nothing safe left. If goal mode is on, unanswered blocking questions must suppress automatic goal continuation. Existing job-finished notifications must not clear question blockers. Goal mode is optional; questions must not require it.

Children: show requester and blocked task IDs in the parent's question list, not hidden only in the child's transcript. Keep the parent as the initial user-facing owner. Route an accepted answer through the runtime's supported continuation path, never shell stdin. **Current native task input is not supported.** In the smallest version, the parent receives the answer and decides the next step; a child that cannot receive it is shown as unable to resume in place. If a child exits with a checkpoint, keep its actual terminal status; label the parent-owned follow-up as waiting, not the exited process as still blocked. Starting replacement work requires a checkpoint and a new task ID linked to the old one. Never relabel that as resuming the old process. Do not promise transparent child suspension/resumption until that backend has an explicit tested capability.

Multiple questions: one list, stable IDs, blocked questions first, then creation order. Reply UI names its target. “Yes” in ordinary chat with several pending questions is ambiguous, not a bulk answer. The same question may block more than one task; keep one card and show all affected work. No semantic deduplication service: the owner reuses a question ID and explicit create-request key on retries. If separate agents ask the same thing independently, the parent may explicitly merge/replace them while preserving provenance.

## Visibility, navigation, and Live

CLI: a compact pinned strip at/above the composer, expandable for full wording and reply. Web: the same projection near the composer, with the selected session's pending count in navigation. More questions than fit means a visible count and list, not silent truncation. Include a text label for blocked state; ordinary pending attention should not be painted as an error. Preserve typing/focus when background state changes. On first transition to blocked, raise one visible attention cue; don't append repeated copies to chat on every task timer.

A different session must not receive the reply just because navigation changed during submission. Bind the reply to its original ID/session, revalidate, and acknowledge there. On reconnect/restart, rebuild the list from durable session records. Show an unavailable task honestly and keep its question/answer. Do not reconstruct a running worker from a saved ID. A branch fork must not wake the original branch's work: version one keeps the question owned by the original branch; another branch can show history but needs an explicit new question to act there. Preserve old records for history, not an unbounded active UI list. Do not auto-open unrelated sessions or expose private child transcript text in a global badge.

Live uses the same records. It may speak a new question once and announce its blocking transition once, but the visible card is the durable surface. Speech interruption only interrupts playback/turn-taking. It does not answer, cancel, resolve, stop work, or stop Live. An ordinary transcript line is not automatically a reply. If the user explicitly replies to Q1 in voice, use the existing eligible captured-user-input authority boundary, bind the target explicitly, and save the captured text with its voice-event reference. Do not let the Live model paraphrase an answer into authority or weaken input-finality/consumption rules. This is a new targeted-reply route to design, not something current transcript persistence already provides. Ambiguous speech gets a brief clarification, not a guessed binding. Initial scope can keep reply entry in the UI while Live can surface questions; label that limit. No hidden automatic new Live session or second tool owner is needed.

## Smallest useful first version

1. One branch-owned durable question record stream, folded on restore, using existing session persistence patterns. Keep ordinary transcript entries for context, not as the only pending-state source.
2. Immediate post, explicit block, targeted reply/cancel, owner resolve/expire. No default deadlines. One owner accepts mutations and returns saved state before acknowledging success.
3. Persistent CLI and web summary/list with a plain text reply action. Shared state, not a separate feature in each frontend. Live can point to that same list; automatic voice-answer inference is out.
4. Wake the parent once with the saved reply ID at a safe turn boundary. If it is already working, queue the answer without canceling independent work. If stopped/paused, save the answer and require explicit resume. If unavailable after restart, show “answer saved; resume needed.” Wake attempts may be retried, but the consumer must see the durable reply ID and must not repeat an already handled continuation blindly.
5. Explicitly show native child in-place reply/resume as unsupported. Parent continuation is the supported route; do not add a general child input protocol as a hidden prerequisite.

Before shipping, test the actual reported sequence: question posted → several progress updates → still visible → one task blocks → answer from the other surface → saved once → correct next turn. Also test two questions, reply/cancel race, stale version, reconnect, restart with missing task, navigation while replying, goal reminder while blocked, child completion while another task is blocked, and voice barge-in without an answer. These are proposed acceptance checks, not tests run for this research.

## Real decisions before implementation

- Is parent-only continuation acceptable for version one, with child in-place resumption clearly unsupported? If not, budget a separate backend continuation design rather than pretending `jobs.input` handles it.
- Should an answer alone resume a deliberately yielded foreground task? Recommendation: yes only when it yielded specifically for that question and remains eligible; never override user pause/stop or restart uncertainty.
- Should voice support explicit targeted answers in the first release, or only announce/show questions with UI replies? Both must preserve the visible list.
- Which CLI region stays pinned while a modal/Live view owns the screen? Verify with a real TUI interaction before promising all views.
- What practical size limits should apply to active questions and answer text? Choose a small explicit cap, reject excess without losing existing questions, and keep terminal history in the normal session retention policy. No silent eviction.

## Values review and work locations

This repeats the existing “Show what is real” lesson: transient notices do not represent unresolved state. A short amendment to value 8 is warranted; no new value. Existing values 3 and 4 already cover single ownership and saved/handled distinctions. The task-attention color note is also relevant: visible does not mean warning-colored.

Integration worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_ccdefa31`; branch `die/research-persistent-asynchronous-user-qu-ccdefa31`.

Codex research worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_ccdefa31-a86675007a5e-task_d079999c`; branch `die/codex-pending-question-source-research-d079999c`.

Architecture research worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_ccdefa31-a86675007a5e-task_acceb3d6`; branch `die/die-pending-question-architecture-survey-acceb3d6`.

Read for this proposal: `wisdom/values.md`, `wisdom/prompts/prose-voice-pass.md`, `wisdom/tasks-ui/attention-notice-color.md`, `wisdom/t3/t3-task-ui-research.md`, `wisdom/goals/goals.md`, `wisdom/live/grounded-spoken-handoff.md`, and `wisdom/web/live-transcript-projection.md`; source review includes `src/typescript/extension.ts` and `src/goals/extension.ts`. Source-specific limits and external citations live in the companion notes, rather than treating older T3 research as proof of present die behavior.
