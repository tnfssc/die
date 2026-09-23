# CLI worktree corrective implementation (in progress)

## Decisions / contract coordination

- Local worktree launches reserve the final child task ID in TaskManager **before** Git or setup. You can inspect or cancel that same task while it prepares. There is no second scheduler or throwaway preparation ID.
- TaskManager gets a narrow agent-preparation lifecycle (reserve, update workspace, activate existing ID, fail existing ID). Its deadline starts at reservation and its AbortSignal owns Git/session preparation. Output is still in the existing bounded task buffer.
- Worktree inspection exposes preparation state on the workspace summary. Preparation failure settles and returns the managed child result instead of throwing away its ID. Batches retain every reserved/launched sibling and return all results. No automatic worktree cleanup or setup retry.
- Blocking setup is owned by the reserved child. Cancellation/timeout stops setup and aborts prep. Setup listeners are removed in finally. Async setup is still a separately inspectable owned command.
- Git base and branch inputs reject option-looking/control-character values. Dynamic rev parsing uses --end-of-options. Managed path collisions are rejected before worktree add.
- Local batch pins source once. Native batch pinning needs backend-owned resolution/cache. Coordinating result/request schema with task_29bb57ca and will not edit its cache/patch area.
- Setup is read from source-root t3.json and run directly by CLI without T3. No new approval boolean/store. Existing project/session ancestry behavior is preserved. No automatic cleanup.

The schema names below were provisional until the backend note arrived.

## Completed corrective implementation

- Added a narrow TaskManager preparing-agent lifecycle. The final child ID is registered before Git/setup, uses the existing bounded output/deadline/foreground/notification machinery, has an owned AbortSignal, and transitions in place to provider execution or terminal failed/killed status. Workspace updates emit lifecycle events.
- Worktree batches reserve all IDs first, share one source-resolution promise, and turn per-item/shared preparation failures into retained task results. Siblings are no longer killed. WaitSeconds:0 returns immediately while setup is blocked. Timeout/cancel abort Git/setup and prevent provider spawn. Sync setup is parent-delivered. Async setup is still separately inspectable and updates attached setup status. Worktrees/branches are never auto-cleaned.
- Existing session preparation, model/thinking/profile, parent/cost-root, history/session directory, role prompt assembly, and inherit foreground timing paths stay in use. Worktree children carry the source trust decision explicitly (--approve/--no-approve) and forward effective custom system/append prompt CLI flags. Untrusted source setup is recorded skipped and never run. Setup is source-root t3.json only. CLI does not invoke T3.
- Added t3.json size bound and setup config digest. Setup is snapshotted once and never retried. Kept existing first runOnWorktreeCreate semantics per coordinator resolution.
- Hardened Git with explicit option/control/whitespace input rejection, --end-of-options/-- separators, exact task-ID grammar, canonical non-symlink managed root, and pre-add lstat collision rejection. Dirty source files stay excluded.
- Mirrored backend workspace result schema exactly for native results: required inherit/worktree discriminant and preparationStatus, immutable worktree base OID, branch, optional worktreePath. Native batches feed the first returned immutable OID into every later launch and reject backend pin drift. Partial native transport errors report retained launched IDs and do not cancel siblings.

## Validation

- `bunx tsc --noEmit`: pass.
- 84 focused tests / 413 assertions pass across worktree workspace, TaskManager, local job bridge, native routing, and production bridge.
- New coverage includes blocked setup wait=0 identity/cancel, preparation timeout with no provider PID, 3-item sibling setup failure retention, untrusted setup denial, ref/task/path collisions, dirty checkout isolation, and one-pinned-OID native batch forwarding.
- `git diff --check` on owned sources/tests: pass.

This work made no commit, install, live-state change, automatic worktree cleanup, or backend cache/patch edit.

## Coordinator final integration correction

Native result workspace is optional for inherit compatibility, required/validated by the caller when worktree was requested. Uncertain is an accepted state. Inherit uses its established spawn/wait/failure path (full suite caught and fixed unintentional changes). Reserved asynchronous preparation is worktree-only. Titles name durable local sessions. Anticipated worktree identity is recorded before Git add, and later preparation failure stops any owned async setup. Full final root suite passes 737 tests with 14 expected skips. Current binary identity is in worktree-feature-implementation.md.
