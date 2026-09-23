# Local worktree implementation review

I reviewed the current `worktree-workspace.ts`, `job-service.ts`, `task-manager.ts`, and `tests/worktree-workspace.test.ts` without changing them. I used the available `worktree-coordinator-review.md`. The requested `coordinator-review.md` did not exist.

## Verdict

**Not acceptance-ready.** Local happy-path creation uses argv and pins one OID per batch, but launch lifecycle, wait/deadline, cancellation, durable preparation status, partial-batch identity, inherited trust/instructions, and native pinning are incomplete.

## P0 — lifecycle and ownership

1. **Preparation blocks before a managed child exists.** job-service.ts:369-450 resolves Git, creates the worktree, runs/waits setup, and creates the session before TaskManager.spawn at :458. Thus waitSeconds:0 still blocks on preparation, and list/inspect/stop cannot name the logical child. A local taskId variable is not managed or durable.

   **Exact fix:** after validation, allocate and register every prompt's logical ID with TaskManager before the first preparation await. Add a real preparing state (or preparation.status) and TaskManager-owned preparation operation/AbortController that transitions the same task to running/failed/cancelled. Persist launch/preparation identity before side effects, then add requested/resolved workspace, OID/path/branch, setup ID/status, session file, and terminal error. list/inspect/stop/shutdown must work while preparing. Run preparation asynchronously so foreground waiting can expire and return background:true while preparation continues.

2. **The deadline does not bound all preparation.** launchStarted is after policy/profile loading; Git receives only caller cancellation, not a timeout signal. Inherit mode does not subtract preparation from timeout or wait (:455-457, :519-521). Async setup has no timeoutMs. Worktree mode subtracts elapsed time only after blocking preparation finishes, and Math.max(1, ...) starts a provider after deadline expiry.

   **Exact fix:** capture absolute local wait and launch deadlines before profile/source/session preparation and combine deadline with caller cancellation. Pass remaining budget/signal through source resolution, creation, setup, session preparation, and provider. At expiry mark the reserved task timed out; do not spawn the provider. Use the same absolute foreground-wait calculation for inherit and worktree. Give setup a manager-enforced bound even when async.

3. **Partial batch failure loses identities and kills good siblings.** The catch at :490-511 kills all prior siblings and rethrows, returning no result array. The failing item's ID/worktree/setup is absent from spawned; source-resolution failure has no IDs. foreground(..., AbortSignal.abort()) merely enables notifications and does not preserve returned sibling IDs.

   **Exact fix:** reserve all sibling IDs first. After acceptance, represent per-item prep failures as terminal task results and return all IDs/statuses; never kill successful/running siblings because another item failed. Shared pin failure transitions every reserved item to failed with its ID. Retain every worktree/branch. Only pre-accept validation should throw without task results. Apply the same rule to native sequential launch, which loses prior launched results if a later call throws.

4. **Setup is not hierarchically owned.** Setup is an unrelated command with no workspace metadata (:389-406). Its random ID is copied into a future agent after spawn. Failure/abort during async setup or session preparation can orphan it because catch owns only spawned agents. Sync timeout is labeled execute-cancellation, closure is not awaited, and setup has no TaskManager timeout. Ownership is one-way: agent stop may stop setup (task-manager.ts:446-450), but setup stop cannot settle a waiting logical launch.

   **Exact fix:** TaskManager owns logical-task -> preparation/setup/provider links before setup spawn. Parent stop/shutdown/deadline cancels preparation and all live process groups, waits for bounded TERM/KILL closure, then settles the logical task. Waited setup must exit zero before provider spawn; nonzero/timeout becomes durable prep failure. For async:true, preserve intended semantics (provider may start after successful setup spawn), but keep setup status attached, surface later completion/failure as a workspace event without pretending the provider never started, and cancel both groups on parent stop. Assign one notification owner.

## P0 — trust and continuity

5. **Repository setup executes without inherited trust.** readWorktreeSetup is unconditional and :387-406 runs arbitrary setup with inherited environment. The new worktree path receives neither the parent's approve nor no-approve decision, so Pi path trust can prompt/fail or load different project instructions.

   **Exact fix:** capture the existing parent project trust decision at CLI/bootstrap and inject it into JobService; do not create a new approval framework or public approval boolean. Map that source-repository decision to its owned worktree. Run setup only for inherited-trusted source; otherwise record denied/skipped and never execute it. Start the child with the matching explicit Pi trust behavior so changing path does not change trust.

6. **Custom instruction/session continuity is unproven and CLI prompt options are dropped.** Child args at :465-475 contain model/thinking/prompt only. Parent system-prompt/append-system-prompt and trust overrides are not forwarded. Existing prompt tests test extension assembly after an event, not this launcher boundary. Session lineage is created only after setup, leaving preparation failures without durable child lineage.

   **Exact fix:** carry the parent's effective custom base/append prompt inputs and trust override into child launch while retaining child-role augmentation. Preserve the established session directory/history adapter and immediate parent/cost-root links; establish durable preparation lineage before side effects, then bind the child session file to that task ID. Worktree should change cwd/workspace only—not model/thinking, cost attribution, session/history discovery, or custom instructions.

## P1 — Git/config safety

7. **Base-ref validation is insufficient.** resolveWorktreeSource:174-180 rejects only leading dash and calls rev-parse --verify with the interpolated ref but no --end-of-options. It accepts reflog forms such as @{-1}, controls/newlines, whitespace, and unsupported revision syntax.

   **Exact fix:** define and enforce accepted ref/OID grammar before Git; reject option-looking, NUL/control/newline/whitespace, @{, and unsupported revision-expression syntax. Call git rev-parse --verify --end-of-options with the validated ref plus commit peel, and use only returned OID for creation. Independently reject option-looking/control branch values before check-ref-format. Add supported -- boundaries to show-ref/worktree add.

8. **Path/ID containment sanitizes instead of failing closed.** createWorktree:204 strips task-ID characters, permitting aliases. Root/target checks are lexical and do not reject an existing symlink target or canonical-root mismatch.

   **Exact fix:** reject task IDs not exactly matching the internal grammar. Create and canonicalize root; require one direct child under it; lstat and reject every existing target, especially symlinks. Preserve fail-on-collision. Never adopt/delete unknown paths or reset/reuse branches.

9. **Config ambiguity is silently accepted.** Multiple runOnWorktreeCreate:true entries select the first (:162-163), and config read is unbounded.

   **Exact fix:** reject multiple setup declarations, cap file size, and record command/config digest with preparation status so trust and at-most-once identity refer to exact source config.

## P1 — native batch pin

10. **Native batches are not pinned once.** job-service.ts:323-354 forwards the same possibly symbolic workspace.baseRef independently to every adapter.launch. HEAD can move between calls; request deduplication is not Git pinning.

    **Exact fix:** add a backend pin-or-batch operation: resolve once before item preparation, return immutable OID/pin ID, and send it to every launch. Do not resolve remote refs locally or treat repeating HEAD as pinning. Preserve acknowledged sibling IDs on later failure.

## Focused tests required

- Block source resolve, create, setup, and session preparation in turn. waitSeconds:0 must promptly return all stable IDs as preparing/background; inspect/list/stop/shutdown must work before provider spawn; timeout includes each phase and no provider starts after expiry.
- Fake-clock inherit and worktree tests proving one absolute wait/deadline across profile/session/preparation; distinguish caller abort from timeout.
- Three-item batch with item 2 create/setup/session failure: response retains IDs 1/2/3, item 1 is not killed, item 2 is terminal with retained workspace, and no setup/provider is orphaned. Also test shared pin failure.
- Sync setup success/nonzero/timeout/cancel and async setup success/late nonzero/timeout, including a TERM-ignoring grandchild. Assert bounded process-group death, output bounds, linked IDs, one notification owner, and retained worktree/branch.
- Private-temp-HOME trust matrix: trusted/untrusted source mapped to new worktree; setup only executes when trusted; explicit child trust and AGENTS.md/.die/SYSTEM.md inclusion match inherit mode.
- Captured real child argv/session metadata for custom base and append prompts: role augmentation is still; parent/cost-root linkage and history discovery stay; worktree/inherit differ only by cwd/workspace.
- Git table tests for leading dash, controls/newlines, spaces, Unicode, traversal-like refs, @{-1}, revision operators, invalid branches, branch/path collisions, and symlink root/target. Assert no marker runs, no existing ref changes, argv/no-shell, and option boundaries.
- Native fake backend moves HEAD between items: exactly one pin and identical OID/pin for every launch. Fail item 2 and retain item 1's acknowledged ID.
- Reject duplicate setup declarations and oversized config; prove stable digest/status and no implicit retry.

Current tests cover JSONC basics, clean pinned creation, branch collision, and preflight rejection of one explicit branch for a batch. They do not cover blocking preparation, cancellation/cleanup, async completion, continuity, or native pin invariants.
