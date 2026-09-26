# Persistent questions implementation

Implemented and integrated on 2026-09-26. Base: `5b8abe612caeb9272c27602e45ad01701a0cec34` (includes unreleased GPT transcript and native audio fixes).

## Durable work

- Integration: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac81ff3b; branch die/implement-persistent-async-questions-and-ac81ff3b.
- Backend/API: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac81ff3b-a86675007a5e-task_f1e93286; branch die/question-backend-and-execute-api-f1e93286.
- CLI/render proof: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac81ff3b-a86675007a5e-task_97286a7a; branch die/questions-cli-ui-and-rendering-proof-97286a7a.
- Review: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac81ff3b-a86675007a5e-task_a38a4291; branch die/questions-independent-review-and-web-pat-a38a4291.
- Goal blocking/tests: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac81ff3b-a86675007a5e-task_2b7fd3a7; branch die/question-blocking-and-goal-continuation--2b7fd3a7.

## Scope and checks

Read values, proposal, Codex source research, architecture survey, and nearby prompt style. Existing value 8 already says unresolved state must remain easy to find; no new value is needed.

The CLI and execute API are the first supported path. Native child input cannot resume a dead JavaScript stack. An accepted answer must be saved before requesting a new parent turn. Live may ask and read; provisional transcript is not targeted answer authority.

Web is a separate production projection, not a free consequence of a CLI custom entry. See [review](implementation-review.md). No web support claim without production projection tests.

Baseline check passed. Baseline focused regression: 117 tests passed across goals, Live execute controls, main owner, extension, GPT session and native audio lifecycle. Worktree uses a symlink to existing repository dependencies and explicit Bun 1.4.2 path; no app install, release or push.

## Supported path

The parent CLI owns a question ledger next to the session file: <session>.questions.json. Writes use a same-directory rename and an exclusive bounded lock. This covers process reload, not a claim of power-loss durability. The first continuation path after each question's anchor owns it. A fork can inspect inherited history but cannot answer it or wake the original branch. New questions on a fork have new IDs.

Execute exposes ask/list/get/block/resolve/cancel. Ask returns at once, with choices/free text, requester, reason and optional affected task IDs. Block names follow-up work and a checkpoint; it does not change a child process status. Only a foreground blocker holds automatic goal reminders. Background completion does not answer or clear a question. UI replies bind the question ID, session/branch owner and revision under the ledger lock. Tool/Live transcript text cannot submit an answer.

The composer footer shows N /questions, with plain waiting/saved state. /questions lists state; detail shows wording, choices, requester and blocked follow-up; answer and cancel target an ID. Answered questions remain discoverable until resolved or cancelled. Errors do not silently clear the count. Internal continuation JSON is non-displayed, not a visible chat bubble.

A saved answer starts a supported Pi new parent turn, never an old execute stack. The runtime waits for idle and does not compete with Live. New work is not resumed after pause, branch navigation or uncertain restart ownership. /questions resume requests a new parent turn for a saved unsent reply. A stable reply ID and atomic durable dispatch claim fence two attached runtimes. If the host may have accepted the turn but its receipt write fails, show delivery uncertainty and refuse a blind replay. User can inspect the parent chat and continue there. This is conservative at-most-once dispatch, not a promise of exactly-once model completion. Resolved means the owner used or closed the question, not that a task succeeded.

Bounds: 20 pending questions, 220 total saved records per session, 20 choices/task IDs, 4,000 question/checkpoint characters, 8,000 answer characters. Explicit create keys deduplicate across progress and retain terminal tombstones. Limits reject new state without eviction; start a new session when the ledger is full. A crashed writer can leave a lock; reads still work, mutations report the lock as busy. Check the old writer before manual lock recovery.

## Scope limits

- No production web question projection/reply UI. Native T3/web calls fail explicitly rather than imply support. Existing upstream task cards are not question support. No production web test claim.
- Children do not directly post into the parent ledger. They return a question/checkpoint to the parent, which can ask with requester/task IDs. Native child in-place reply is unsupported; a finished child stays finished. This is narrower than the full proposed parent/child relay.
- Live can call the same parent ask/read API. Replies stay in /questions. No provisional transcript matching and no targeted voice reply path. Live-owned answers stay queued; settle after ownership ends or an explicit resume provides a safe parent boundary. No device microphone/audio test was run for this feature.
- No background watch service across two independently opened CLI processes. Each CLI refreshes from disk on its normal events and commands; mutation/dispatch races are fenced in the ledger.

## Proof and review

- Real isolated execute test asks, continues independent code, blocks, reads and resolves. It verifies there is no model-facing answer helper.
- Store tests cover reload, choices, explicit block, stable reply/create retries, stale versions, answer/cancel race, fork read-only ownership, navigation while a lock is held, and caps without loss.
- Runtime tests cover busy/Live-owned delivery, pause/navigation, missing owner on reload, late old-session callbacks, stable reply retries, competing runtimes, and a failed receipt write after host acceptance.
- A real offline Pi SDK assembly runs /questions answer and observes exactly one new model turn with the saved reply; its persisted custom message has display=false. An exact answer retry does not create another turn. This proves the supported continuation seam, not a real network model decision.
- Real tmux TUI test covers two questions, progress scrolling, detail, cancel and process reload. The manual standard harness run is recorded below. Ordinary pending color and narrow/Live footer layout have direct renderer tests.
- Initial broad run had ten unrelated exact-output failures from fish/mise warnings plus one stale footer expectation. Shell tests passed with an explicit clean Bash test environment; no shell product behavior was changed. An intermediate broad run loaded a UI module before a pending test edit and had one mismatch; focused rerun passed. Final frozen-source run is recorded at handoff.

Manual integrated harness: scripts/tui-harness.ts start questions-integrated --offline --no-approve --session <seed-file> --extension /tmp/questions-harness-fixture.ts, then frame/send /qprogress/frame/send /questions detail/frame/stop. Fixtures seeded the real ledger and emitted 50 independent progress lines; no model or device was used. Pending frame shows 2 /questions waiting directly beneath the composer. After all progress and “Independent work complete”, the same footer remains. Detail shows choices/requester/checkpoint without ledger JSON. Raw evidence: artifacts/tui/questions-integrated-2026-09-26T09-13-04.347Z/transcript.ansi and artifacts/tui/questions-{pending,progress,detail}.txt. These are local ignored artifacts; repeatable TUI test is committed. Earlier fixture-only worker proof in cli-rendering-evidence.md is narrower and is not used as persistence proof.

CLI compilation reused the base web archive and compiled current src/cli.ts. It did not rebuild/test a web question surface. No app install, push, publication or release was done here; parent owns any later release decision.

## Later worker paths

- State hardening: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac81ff3b-a86675007a5e-task_34e6027b; branch die/harden-question-state-and-race-semantics-34e6027b.
- Runtime tests: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac81ff3b-a86675007a5e-task_455100fb; branch die/questions-runtime-integration-tests-and--455100fb.
- Final independent review: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac81ff3b-a86675007a5e-task_d6e62737; branch die/final-question-implementation-review-d6e62737.

Final review found a real dispatch/receipt crash window. Integration added a durable atomic claim plus uncertainty state and failing-write/two-runtime tests; do not claim a retry can safely ignore that claim. Parent surface review also led to hiding continuation metadata, removing an unusable answer tool, clearer discovery/help and keeping saved answers visible. Values stay unchanged: existing visibility, ownership, bounded state and truthful evidence values cover this work.
