# Live main orchestrator: implementation and release

## User decision

User said: "not prototype, lets make it". Then: "make a release when done".
This supersedes the investigation-only scope. Build the production path,
review and test it, then publish a release. Parent owns final integration and
release from the main checkout. No need to keep the companion design.

Same ordinary main-orchestrator prompt assembly, execute tool/runtime/helpers,
session/history/permissions/jobs. Voice is the active main transport, not a
second agent forwarding requests to another main. Gemini Live and OpenAI
Realtime are the direct-tool candidates. GPT-Live's separate delegation is
not equivalent; block/remove that selection clearly rather than silently
keep a different architecture under the same mode.

## Work running

Base: 411f2608fc037a8dc0a30942edc5140057daa400 on develop.

- task_3b87c7af, implementation orchestrator. May delegate workers and owns
  integrating their changes before returning a cohesive implementation.
  Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3b87c7af
  Branch: die/build-live-as-the-main-orchestrator-3b87c7af
  No release/install/push from that worktree; parent handles release.
- task_28d0a4b5, independent read-only source/SDK architecture review in the
  main workspace. Returns concrete API seams and review traps for parent.

Parent will inspect implementation, run integration checks and fix gaps.
Do not merely collect worker reports and publish them as a working feature.

## Acceptance focus

- Effective normal prompt and tool parity, even before first text turn.
- Real registered execute using the root's existing runtime/job authority.
- One main-turn owner: typed input, speech, job completions and attention
  cannot accidentally wake a second main model or run stale voice calls.
- Same current-branch user/assistant/tool history and honest transcript state.
- Interruption stops speech, not jobs; explicit voice/work stops still work.
- Bounded result/error/image/large-output mapping with no silent drop.
- Clean failure, reconnect, shutdown, branch/session change and text fallback.
- Existing companion-specific tests replaced where behavior is intentionally
  removed. No hidden compatibility layer just to preserve old tests.

## Provider acceptance limit

Investigation found missing canonical Google/OpenAI API keys. Do not seek
alternate secrets or change credentials. Run offline provider/session seams
and real isolated runtime/jobs. Connected provider/audio acceptance remains
unverified unless the user configures a key in the normal app setup. Release
notes must say what changed and state real test limits. Do not claim physical
voice or paid provider validation from fake transports.

## Release plan

Read .github/workflows/release.yml and current release wisdom before tagging.
Pick the next unused version after checking tags/current remote state. Run the
shared local gate, hosted CI and exact-SHA release dry-run as required by the
current workflow; fix failures before tag publication. Verify release and
nonempty expected assets. Do not download large published binaries merely to
rehash them: passing release CI already hashes/uploads the same files.
See ../releases/release-verification-preference.md.

No tag/push/release/install has happened for this feature yet. Current work
is separate from the main checkout's committed investigation/review docs.
Values unchanged at kickoff: one owner, shared source of truth, truthful
proof and durable handoff cover this implementation. Revisit after review.

Release preflight: GitHub latest is v0.12.1 (checked 2026-09-25). Workflow
runs full dry-run gates on develop pushes and publishes stable v* tags after
exact-SHA asset reuse checks plus Mac smoke. Notes must be nonempty at
support/release-vVERSION.md; package version must match tag. A feature minor
release is likely, but recheck unused tags before choosing the final version.

## Independent source review

See [main-orchestrator-architecture-review.md](main-orchestrator-architecture-review.md).
The key review requirement is full Pi lifecycle parity, not merely calling the
registered execute callback. Pi beforeToolCall/afterToolCall handle tool denial
and result mutation. Reading getSystemPrompt before a turn misses final
before_agent_start/context hooks. The installed SDK stream boundary receives
the fully assembled transcript, so a controlled main stream transport is the
preferred seam if it fits native Live audio. Parent must check these facts
against implementation before release. All history/tool ordering and completion
triggerTurn routing need tests, not just the old runtime reachability probe.

## Mid-build review

Implementation integration worktree has GPT-Live removal and direct provider
changes committed. Shared owner/extension integration and vertical tests are
still running; baseline test success is not finished-feature proof. Parent
started read-only task_f74a0ace to review provider commits 21e0abd and 4fc995c
for wire/result/context bugs before final release review. Worker coordination
notes in the implementation worktree contain parent lifecycle-hook concerns.

## Parent draft-core review

At the 31-minute checkpoint, shared owner source and vertical tests were
integrated but still being fixed. Parent flagged overlapping tool/conversation
history order, frozen per-acquisition context vs active mode/policy changes,
and silent custom tool-loadout reduction in LIVE-COORDINATION.md. These are
review questions/blockers to check against the final commit, not final failing
results. Session tree/fork/switch hooks were verified to stop foreground calls
separately from ordinary live.stop. Provider review false positive and confirmed
receive-size issue are recorded in main-orchestrator-provider-review.md.

At the 44-minute checkpoint, implementation was addressing all three parent
core concerns with queued history, per-user-turn preparation and explicit
changed-policy rejection. Parent started read-only task_f72bc8a1 against the
integrated working tree for final ownership/lifecycle review. Do not tag until
that review and final full-path suite results are checked.

Independent review task_f72bc8a1 found two confirmed draft blockers: immediate
canonical appends interleave concurrent call/result pairs, and missing final
ASR leaves pendingTranscript unresolved after turnComplete. Parent rechecked
current source and sent exact reproduction/test requirements through active
coordination. No release until both are resolved. See
[main-orchestrator-final-review.md](main-orchestrator-final-review.md).

## Final blocker fix ownership

At 16:24 both reviewed blockers remained in draft code. Parent started
task_1bfbf386 for a narrow fix from commit 38cdffb plus the implementation
working diff. Worktree:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_1bfbf386
Branch: die/fix-live-history-overlap-and-missing-asr-1bfbf386.
Snapshot patch temporarily saved at main-owner-review-snapshot.patch; worker
will commit the snapshot separately, then fixes. Cherry-pick only the fix
commit after the implementation handoff, not the duplicate snapshot baseline.
Implementation orchestrator was told through LIVE-COORDINATION.md that parent
owns those fixes and final release.
