# Worktree Git Safety Investigation

_Investigation complete. No product code changed._

## Scope and source evidence

Build the CLI-first flow as **main checkout -> five isolated worktrees -> five branches/PRs**. Do not start T3. The API proposed in wisdom/t3/t3-worktree-design.md is workspace { kind: inherit | worktree, baseRef?, branch? }, with inherit as the default. Native delegation does not create a worktree today. The reviewed project wisdom shows children inheriting the parent's worktreePath and branch. Use the adopted T3 source at immutable revision **a9b49a7df0a4261dcc438d4493cc3154a1d9819e** from web/t3-source.json, not .cache/die-t3code. The adopted patch routes separate top-level worktree launches to T3. It does not provide a standalone Git helper to reuse.

Root package/lock inspection found no Git worktree library (no simple-git/isomorphic-git). Existing reusable process machinery is src/tasks/task-manager.ts: argv spawn with shell:false, POSIX detached process groups, group SIGTERM then SIGKILL, and a 1,000,000-byte rolling BoundedOutputBuffer. It is suitable behavior to reuse for setup. But Git preparation should stay a small argv-based module and must not become a visible generic job or pull in web/server state.

## Verified findings

Local deterministic fixtures ran under owned /var/tmp/die-wt-*, with private HOME, GIT_CONFIG_NOSYSTEM=1, no network/credentials, and were deleted afterward. Host Git was 2.54.0. These are Linux-only observations, not cross-platform claims.

- Resolve once with git rev-parse --verify --end-of-options <baseRef>^{commit}. A dirty main checkout retained its modified tracked file and untracked .env-like file while five concurrent git worktree add --no-track -b <unique> <path> <pinned-oid> calls all succeeded. Every child had the same pin and its own branch.
- A repeated -b die/task-0 failed (255) rather than resetting/reusing the branch. Detached HEAD resolved to the same commit and was a valid base. A local bare clone could create a linked worktree. But only this basic operation was tested.
- git worktree list --porcelain -z is stable/config-independent and NUL-safe. After externally deleting one linked path, it appeared prunable and targeted git worktree remove <exact-path> removed its registration. This does **not** justify repository-wide prune.
- In a local-submodule fixture, worktree creation succeeded but the submodule directory was initially empty. Explicit submodule update --init --recursive populated it. Then ordinary worktree remove refused because the tree contained a submodule. Thus submodules need explicit setup/preservation policy. Do not force-remove them.
- Git's documented safeguards agree: -b rejects an existing branch; -B resets it. Remove rejects unclean trees unless forced; --porcelain -z is the script interface. A separate fixture verified add --lock --reason die:fixture, saw the reason in porcelain inventory, confirmed removal was blocked, then unlocked and removed cleanly.

## Recommended minimal CLI contract and operations

1. Discover the repository and canonical common-dir with argv calls (git rev-parse --show-toplevel and --path-format=absolute --git-common-dir). Reject a non-repository. Treat bare repositories as unsupported initially despite the one successful Git fixture, unless a focused product test establishes cwd/setup semantics.
2. Before launching a batch, resolve baseRef or HEAD **exactly once** to a commit OID. Pass that OID to all N creates. Never resolve per child. Dirty parent state is neither copied nor rejected. Return a clear note that uncommitted files are absent.
3. Branch means **new branch**, never “adopt existing.” For explicit names: reject empty/control/NUL, @{-n}, and leading dash. Validate refs/heads/<name> using git check-ref-format. Independently verify show-ref --verify --quiet refs/heads/<name> is absent. Generated names should be readable plus a launch/workspace random suffix, e.g. Die/<slug>-<10+ random hex>. Never use -B, --force, or concatenate a shell command.
4. Store worktrees on persistent disk outside the source checkout: <die-state>/worktrees/<hash(canonical-common-dir)>/<workspace-id>. The workspace ID is app-generated, a single path component, and the resolved parent/path must stay under that root. Do not use basename-derived identity, repo-local directories, RAM, or /tmp for user-bearing worktrees.
5. Invoke Git as an argv array with shell:false, controlled cwd, closed stdin, bounded stdout/stderr, GIT_TERMINAL_PROMPT=0, and no credential/config rewriting. Minimal create is git worktree add --lock --reason die:<workspace-id> --no-track -b <branch> <absolute-path> <oid> (feature-detect --lock/--reason, or omit rather than guessing compatibility). Parse inventory only through worktree list --porcelain -z.
6. Run setup in the new cwd only after Git reconciliation says ready. Setup source must be explicit and trusted/CLI-readable. Never boot T3 to obtain settings. Start child only after required setup succeeds. Setup failure/cancellation leaves the workspace preserved and reports its path.

Recommended result invariant: return immutable workspaceId, canonicalCommonDir, canonicalPath, fullBranchRef, pinnedBaseOid, ownerLaunchId, state. Child cwd must equal canonicalPath. For a five-item batch, allocate all IDs/branch names and pin first, then create concurrently. One failure does not cancel/remove siblings.

## Idempotency, ownership, and safe cleanup

Create an exclusive, atomically-written manifest **before Git I/O** (planned -> creating -> ready), keyed by durable launch/replay identity. It records exact common-dir, managed-root path, branch ref, and pin. On retry, reconcile that manifest against NUL-porcelain inventory and the worktree's Git metadata:

- exact matching registered path/ref is the same workspace (branch may legitimately have advanced after ready);
- any pre-existing path, ref, mismatched registration/common-dir, or nonempty unknown directory is a conflict, never something to adopt/delete;
- a manifest in creating state plus its generated high-entropy ref at the original pin may be resumed. But ambiguous orphan refs/paths are preserved and surfaced for manual recovery—not guessed away.

Do not globally prune, recursively delete, force-remove, reset, clean, or auto-delete branches. On setup failure, child failure, cancellation, crash, or any possibility of user activity, preserve the worktree and branch. Normal lifecycle should retain completed worktrees for PR/follow-up use. Explicit cleanup may unlock and use targeted git worktree remove <exact-path> only after descendants are stopped and both status and filesystem checks establish no modified, untracked, **ignored**, nested-repo, or submodule content. Keep the branch so committed work is still reachable. If any check is uncertain, report the path and stop.

Ownership is hierarchical: batch owns workspace records. Each workspace owns setup and child process groups. Cancellation first terminates the selected setup/child group (SIGTERM, bounded grace, SIGKILL), waits for pipe/process close, then considers Git cleanup. Reuse TaskManager's tested POSIX group behavior and bounded buffer rather than a new shell runner. Cap setup runtime, cap retained combined output (existing 1 MB is a reasonable upper bound), mark truncation/logical offsets, and never retain unbounded chunks or include environment values in logs. Windows process-tree behavior is still unverified.

## Secrets, disk, and lifecycle

Git naturally checks out tracked secret files. Warn rather than pretending otherwise. Untracked parent .env files are absent from the child and must **not** be blindly copied. Prefer setup that regenerates credentials through the existing trusted mechanism. If explicit copy is later required, use a user-approved filename allowlist, reject symlinks/non-regular files and destination escapes, preserve restrictive permissions (0600), never log contents, and record provenance. Worktrees and ownership manifests belong on durable disk. Only bounded stream buffers may be memory-resident. Show disk usage/path and give explicit retention/cleanup UX.

## Focused test matrix before implementation acceptance

- 1 and 5 concurrent creates from clean, dirty, detached-HEAD parents. All share one captured OID and unique branches/cwds.
- Invalid/injection-like branch/base/path inputs (leading dash, @{-1}, spaces/newlines, Unicode, traversal). Prove argv/no-shell behavior and ref/path containment.
- Explicit/generated branch collision. Path collision. Branch checked out elsewhere. No -B/force and no changed existing ref.
- Crash at each manifest/create transition and replay. Missing linked path. Stale registration. Mismatched manifest. Targeted reconciliation only.
- Setup success/failure/timeout/cancel with a TERM-ignoring grandchild and >output-limit producer. Prove process-group death, truncation, and preserved workspace.
- Child creates uncommitted, untracked, ignored, committed, nested-repo, and submodule work. Every failure/cancel cleanup preserves it. Clean explicit cleanup keeps branch.
- Tracked and untracked .env, symlink cases, permissions, and logs contain no secret value.
- Disk-full/permission-denied during manifest, branch, checkout, and setup. N=5 partial success is still independently recoverable.
- Bare and submodule repos stay disabled unless their dedicated expected behavior is adopted. Add separate Windows/macOS fixtures before claiming support there.

## Unknowns

Not verified: older Git compatibility for worktree add --lock --reason, SHA-256 repositories, sparse checkouts/LFS, linked-worktree config variants, filesystem case-folding, Windows process trees/path rules, macOS, network filesystems, disk-full interruption timing, and safe initialized-submodule cleanup. These should stay explicit non-claims rather than generalized framework work.
