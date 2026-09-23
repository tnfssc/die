# CLI-first worktree lifecycle investigation

_Investigation complete. No product code was built or changed. Nothing was installed, and no service was started._

## Evidence boundary

I checked the current Die working tree and adopted descriptor, not .cache/die-t3code. The fixed T3 revision is **a9b49a7df0a4261dcc438d4493cc3154a1d9819e** (web/t3-source.json. Shortened to a9b49a7d in wisdom/t3/t3-v2-delegation-status.md). This checkout already held the main effort's changes. These findings describe those files, not upstream HEAD.

Standalone Die must invoke Git directly and never start T3. An already-running T3 backend may stay authoritative in web mode. But its DB/config is not a CLI dependency.

## Current standalone behavior (verified)

- JobService's strict Agent schema (src/tasks/job-service.ts:34-40) accepts only type/prompt/prompts/waitSeconds/timeoutSeconds. src/typescript/job-bridge.ts forwards subagent options as an open record. The service schema is the local API seam.
- Local launch is JobService.#handle at src/tasks/job-service.ts:288-424. It resolves ~/.die/subagents.json via loadProfiles/resolveProfile, calls prepareAgentSession(ctx.cwd, parentSessionDir,...), then TaskManager.spawn with cwd=ctx.cwd. Batches prepare/spawn sequentially. A later failure kills launched siblings and transfers notification ownership before throwing.
- prepareAgentSession (src/tasks/agent-session.ts) uses Pi SessionManager.create(cwd, explicitSessionDir, parentSession), immediately creates the JSONL header with exclusive create and mode 0600, then appends die-agent task/type/model/thinking/depth/parent metadata. Identity exists even on provider stall.
- sessionCostRoot (src/tasks/session-cost-root.ts) returns the parent transcript or a stable synthetic identity in Pi's per-cwd session directory for no-session. SessionCostTracker discovers descendants in one session directory by parent metadata. A worktree child transcript must stay in the parent's original session directory while its header cwd is the worktree. Separate worktree transcript directories break current aggregate costs.
- TaskManager.spawn (src/tasks/task-manager.ts:178+) owns one detached process group, timeout/escalation, stdin, bounded output, inspection and completion. waitSeconds controls foreground waiting. timeoutSeconds controls process lifetime. jobs.stop signals the group. Session shutdown kills running local jobs. Task/inspect state is in-memory.
- createTaskLifecycleRecorder writes bounded append-only 0600 parent.jobs.jsonl evidence, not a restart registry. JobAttentionScheduler watch/snooze/timers are in-memory. Resume/restart does not recreate tasks or attention.
- History is transcript-backed. A child is readable with its durable session file and explicit cross-session permission. Parent-default history does not merge all children.
- Herdr (src/herdr-agent-state.ts) activates only at depth zero, reports the root pane/session, and uses running-task count for root working state. It does not register five child panes.
- Child agents inherit process.env after scrubT3BridgeEnvironment. That removes T3 bridge secrets, not all credentials. Setup must not inherit provider credentials merely because the later agent needs them.

## Safe cwd, session, instructions, memory and trust

For each accepted child:

1. Ask Git for the parent's repository top-level/common git dir, canonicalize them, and derive a private path from a repository-identity hash plus preallocated task id under a Die-owned 0700 root. Never interpolate prompt/title/branch into a path.
2. Resolve baseRef to a local immutable commit before creation. Omitted means parent HEAD commit, never index/working-tree contents. Requested main follows an explicit documented local ref-resolution rule. No implicit fetch. Use argv, option termination where supported, and reject option-looking/ambiguous refs.
3. Invoke Git directly to add a worktree pinned to that OID. Prefer an automatically unique die/task-id branch if completed edits/PRs should stay reachable. Detached HEAD should require explicit read-only intent.
4. Launch Die with canonical worktree root as cwd. But prepare the session with parentCostRoot.directory and parentCostRoot.file. This preserves cost/identity while making tools and resources worktree-local.

Pi's installed DefaultResourceLoader.loadProjectContextFiles searches global context then cwd ancestors for AGENTS.override.md, AGENTS.md variants and CLAUDE.md variants. It has linked-worktree shadow handling for a nested worktree whose context shadows the main-worktree context. Sibling/outside worktrees load their checked-out copy and own ancestors. Project .pi system/append prompt, extensions, skills and settings are cwd-relative and trust-gated.

Trust is canonical-path based: ProjectTrustStore finds the nearest stored entry. A sibling worktree is not necessarily covered by trust granted only to the main checkout. Headless unresolved trust fails closed. Never silently trust generated worktrees. Preflight trust-requiring resources and require an existing applicable decision or explicit root-user authorization before async launch.

Project memory is root-only (src/memory/extension.ts). So children cannot consolidate it, although checked-out wisdom are ordinary files. Since the child starts at a pinned commit, dirty parent memory/instructions are absent. Prompt framing should state path, branch, adopted OID and that dirty parent changes were excluded.

### Dirty parent and requested base

Never stash, reset, clean, checkout or mutate the parent worktree. Dirty state is allowed but not copied. If required, reject/explain or require a separately authorized future snapshot feature. Never synthesize a commit. Persist both requested baseRef and resolved OID so movement of main cannot change retry behavior.

## Recommended request contract (conceptual)

Keep the existing default as workspace.kind=inherit. The worktree variant should carry only declarative intent: baseRef (optional), branch (optional), setup policy/reference (optional and explicitly authorized), and retention policy (default preserve). For prompts batching, one workspace object is a template but each prompt receives a distinct generated path and distinct effective branch. Never share a worktree. Return effective path, OID, branch and phase per task. baseRef is resolved once per batch to an OID before any creation, while each branch/path is still independent. Reject a caller-supplied raw destination path in the initial API. Generated paths make ownership and cleanup materially safer.

API semantic invariants: workspace fields do not weaken delegation/profile limits. Inherit behavior is unchanged. Positive waitSeconds and timeoutSeconds retain local meanings. Stop targets only the selected task/process group. Inspect/list stay available through setup and expose bounded phase metadata. A setup failure is a task failure, not permission to delete the worktree.

## Setup: blocking operation versus job phase

**Recommendation: preparation/setup is the initial phase of the same TaskManager-owned logical job, not blocking work before a task id exists.** Five requests reserve five durable ids, prevalidate, then prepare with bounded concurrency. Suggested phases: reserved, worktree-creating, setup-running, agent-running, terminal. The id is still valid for list/inspect/stop. waitSeconds spans setup plus agent. timeoutSeconds bounds that same lifetime. Setup output is bounded inspect output with phase markers.

Keep the prototype small and compatible with the process model. Launch a Die-owned worker entrypoint through existing TaskManager.spawn. Have it read a 0600 manifest, call Git with argv, run authorized setup in a separately scrubbed environment, and launch or exec normal Die in the same process group. Stop, timeout, output, wait, attention, and completion then keep using the existing path. Existing TaskManager needs AgentInfo, including sessionFile, when it spawns. Choose one of two narrow changes: create one child transcript up front for the future cwd and reuse it, or let command/preparing move once to agent/running. Never create a transcript for each retry. Portable exec handoff and AgentProgress handling of the setup prelude still need proof. If either fails, add that narrow deferred phase. Do not build shell choreography.

Blocking setup in JobService has bad semantics: slow setup has no inspectable id, execute AbortSignal is its only cancellation, and a five-item batch may create resources before identities return. Current rollback kills useful siblings. With accepted async jobs, setup failure terminates that id and siblings continue. Never discard the launch response after side effects exist.

Batch rules:

- Validate schema, delegation/profile, repository, trust/setup policy, branch conflicts and every base OID before side effects.
- Reserve all ids/manifests before starting. Resource-time failures become results on those ids.
- Reservation failure creates nothing. Cancellation after reservation cancels only that call's jobs, never unrelated siblings.
- Preserve workspace kind inherit as default and current local waitSeconds/timeoutSeconds/jobs semantics. The execute bridge needs no transport redesign.
- Existing remote T3 needs explicit workspace schema support. Standalone must never boot T3 as fallback.

Setup config is unresolved. T3's backend DB cannot be assumed. The honest CLI API is explicit launch-time setup (prefer argv/cwd/env declaration) or documented lightweight user/repo config. Never claim web setup ran. Repo setup is arbitrary code and requires trust/confirmation. Git creation should be local/no-fetch. Run setup with an allowlisted environment (PATH, temp, HOME only if needed, explicit grants), excluding provider keys and T3 URL/bearer. Launch the agent afterward with normal child env plus current T3 scrubbing. Persist/display no secret env.

## Required durable workspace manifest

The jobs journal is insufficient for retry/inspect/reconcile/cleanup. Store an atomic versioned 0600 manifest outside the worktree, keyed by task id and linked to parent session. No credentials or prompt body. Record:

- request/replay identity and task id. Parent session id/file or synthetic cost root. Child session file;
- source cwd/top-level, canonical common-git-dir identity (path/hash and preferably device/inode), requested base and resolved OID;
- generated canonical worktree path, requested/effective branch/ref, initial ref/OID, ownership nonce;
- profile/depth/model/thinking and hash/redacted setup policy, never secret env;
- monotonic phase/timestamps, setup/agent attempt counts, outcome/cancellation;
- process metadata only diagnostically (PID alone never proves identity after restart);
- cleanup eligibility, last verified HEAD/ref/dirty state, explicit retention/removal request.

Persist reserved and fsync file+directory before Git I/O. Retry reuses OID/path/id and verifies canonical path, .git linkage/common dir, ownership nonce, git worktree list --porcelain, HEAD and ref. Mismatch fails closed. Never infer ownership from path prefix alone.

## Visibility, lifetime and cleanup

A workspace is visible via git worktree list --porcelain. Expose path/base/branch/phase in summary/inspect. Completion does not delete it. Preserve after success, failure, timeout, cancellation and PR creation. A remote PR branch does not authorize local cleanup.

Cleanup must be explicit/idempotent. Remove only a manifest-owned worktree with matching registration/linkage, no live owned process and declared safe state. Refuse dirty/untracked files, unexpected HEAD/ref, nested repos or ownership mismatch. Never force worktree removal, git clean, or implicit branch deletion. Git prune may follow proven safe removal. Branch deletion is separate. Interrupted creation becomes needs-reconcile. Automatic rollback is allowed only for an empty proven-owned path before setup/user code ran.

## Bounded state/resource invariants

1. One manifest and path/registration per task id. Retries never allocate another or adopt unowned state.
2. Global/per-parent caps bound reserved+preparing+running jobs and setup concurrency. Over-capacity batches fail before side effects.
3. One process group per logical job. Timeout/stop covers Git, setup and agent. No setup descendants escape.
4. Keep current 1 MB running output, 5 KB inspect page and completed aggregate budget. Bound manifest fields, paths, refs, argv and diagnostics too.
5. Manifests contain no prompt, credentials, setup env or command output.
6. Parent shutdown stops groups but preserves files. Restart may inspect/reconcile. Never signal a PID or resume without positive process identity.
7. Child transcript is exclusive-created once in the parent cost directory with one parent identity and reused across setup retry. A retry never creates another transcript. An up-front transcript may represent a setup failure and should be treated as durable attempt evidence, not a successful agent launch.
8. Ref updates use expected-old-OID transactions where possible. Never overwrite existing/user/elsewhere-checked-out branches.
9. Attention stays bounded/in-memory. Do not claim restart restoration unless separately persisted.
10. No implicit network/fetch, T3 startup, parent mutation, forced removal or trust grant.

## Exact extension points and current tests

Minimal seams: extend Agent at src/tasks/job-service.ts:34-40. Add a provider-neutral local workspace request/manifest/preparer at JobService.#handle:288-424. Retain prepareAgentSession but pass child cwd/parent session dir. Add phase/workspace metadata to TaskLaunch, TaskSummary and ManagedTask. Emit phases through task-lifecycle.ts. Document options. job-bridge.ts already forwards arbitrary options. Do not couple CLI prep to t3-native-task.ts or web server/DB code.

Coverage: tests/job-service.test.ts covers schema/profile/identity/depth/partial batch failure. Tests/task-manager.test.ts covers concurrency/process groups/timeout/shutdown/stdin/output/races. Session-cost tests cover synthetic roots and descendant accounting. Tests/subagent-extension.test.ts covers identity/completion/attention/shutdown. History, memory, bridge and Herdr suites cover their boundaries. No workspace provisioning test exists.

## Minimal experiments

1. Temporary no-network repo: create five pinned worktrees concurrently, cancel one in slow setup. Four continue, no process is still, parent status/index unchanged, manifests/registrations reconcile.
2. One real child with worktree cwd and parent sessionDir: verify header parent/cwd, cost, explicit child history, AgentProgress, completion/attention and root-only Herdr.
3. Distinct committed versus dirty AGENTS.md/.pi: only pinned files load, no duplicate context, unresolved headless trust fails closed.
4. Crash before/after manifest fsync, worktree add, setup, transcript and child spawn. Restart read-only reconciliation creates no duplicate, signals no reused PID and deletes nothing.
5. Hostile refs/names, symlinks, existing destination/branch, moved git dir, dirty result, setup flood and secret env: assert argv-only Git, bounds, refusal and no leaked secret.

## Unknown / decisions required

- Public workspace/setup schema, default branch/retention, caps and whether queued time counts toward timeout.
- CLI-readable setup source and authorization UX.
- Portable worker-to-agent handoff and AgentProgress setup-prelude behavior.
- Whether first release only reconciles after restart (recommended) or truly resumes setup/agents.
- Remote T3 option compatibility, versioned separately against the adopted backend schema.
