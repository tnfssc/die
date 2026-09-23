# CLI/background-job lifecycle and leak audit

Date: 2026-09-18
Scope: read-only audit of CLI and background-job code under `src/cli.ts`, `src/tasks/**`, and `src/typescript/**`. Web server/frontend excluded. No product files changed.

## Confirmed reachable findings

### 1. Execute job bridge retains every server request and cancellation listeners until the whole execute process exits (medium)

**Evidence**

- Every bridge request gets an `AbortController` and is inserted into `requests`: `src/typescript/job-bridge.ts:617-620`.
- A successful reply changes the request to `sent` (`513-547`), and its ACK only changes it to `acked` (`586-604`). The ACK path does **not** delete the entry.
- Entries are only released when the entire bridge closes/fails: `488-511`. Retaining ACKed requests until clean worker exit is used to defer ownership commit (comment at `492-499`), but the implementation does this for every RPC, including observational `jobs.list`/`history.*` calls which own no task result.
- Each product RPC is wrapped at `src/typescript/extension.ts:91-102`. `withJobCancellation` adds abort listeners to both the per-request bridge signal and the execute-wide `handoffWaits.signal` (`src/typescript/job-bridge.ts:84-104`). Those listeners are cleaned only on abort or the ACK event. The ACK event itself is intentionally deferred until bridge close (`488-501`), so sequential, already-resolved RPCs continue to occupy entries/listeners while user code keeps running.

**Reachability / impact**

An execute script can simply make many sequential calls such as `await jobs.list()`. Memory and listeners grow linearly for the lifetime of that execute call. A long-running execute worker therefore retains all prior RPC controller/listener graphs even though the worker has received and acknowledged their results.

Isolated Duplex repro using the real `serveJobBridge`, `installJobGlobals`, and `withJobCancellation`:

- 1,000 sequential acknowledged `jobs.list`-style RPCs left **1,000** abort listeners on the shared handoff signal; closing the bridge reduced this to 0.
- 10,000 sequential RPCs left **10,000** listeners and measured about **5.29 MB heap growth after forced GC** on Bun 1.4; bridge close released the listeners.
- Repro used `/tmp/die-bridge-leak-repro.ts` and made no repository changes.

This is scoped retention rather than a process-lifetime permanent leak, but it is unbounded during one user-controlled execute invocation. Keep only the minimal commit token for result-owning foreground calls, and delete/abort request state immediately for observational/error/background replies. Alternatively separate delivery-commit state from request cancellation state.

### 2. Cancellation between child-session preparation and spawn leaves an orphan persisted subagent session (low/medium)

**Evidence**

- `prepareAgentSession` creates the child session file and writes durable header/identity records before returning: `src/tasks/agent-session.ts:12-23`.
- The launch loop awaits preparation, then checks cancellation, then spawns: `src/tasks/job-service.ts:171-205` (especially `173-180`). If cancellation arrives while preparation is awaiting import/file writes, line 180 throws after the file has been created but before the task is added to `spawned`.
- Batch cleanup only kills/foregrounds tasks already present in `spawned`: `src/tasks/job-service.ts:207-226`. It has no path for the prepared-but-not-spawned session file. A synchronous spawn failure has the same orphaning outcome.

**Impact**

Each hit leaves a child JSONL session containing a header and identity entries but no managed task/process. Repeated cancelled subagent launches cause permanent small-file/history clutter in the session directory. This differs from successfully spawned child session files, whose persistence is intended history. Track the currently prepared path and remove it only when spawn never takes ownership (with careful fail-closed handling), or defer persistence until ownership can be recorded atomically.

### 3. Job/execute termination does not kill descendant process trees on Windows (platform-specific, high when applicable)

**Evidence**

- Task children are only detached on non-Windows: `src/tasks/task-manager.ts:162-168`.
- POSIX cleanup signals the negative PID (process group), but Windows calls `task.process.kill(signal)`, which targets only the direct child: `src/tasks/task-manager.ts:547-556`.
- The same direct-child fallback is used by isolated execute cleanup: `src/typescript/execution.ts:33-39`; its spawn is likewise detached only off Windows (`81-87`).
- Stop/timeout/shutdown paths all ultimately rely on these helpers (TaskManager `409-469`; execute `108-130`). Destroying/unrefing the direct child's streams does not terminate grandchildren.

**Impact**

A shell command or execute script that starts a long-lived grandchild can survive `jobs.stop`, timeout, session shutdown, or execute cancellation on Windows. The orphan can retain memory, files, sockets, and CPU after Die reports cleanup. Use a Windows process-tree primitive (for example a Job Object, or a carefully controlled tree-kill mechanism) rather than only `ChildProcess.kill`.

This was established by control flow/API semantics. The audit host is Linux, so no Windows runtime repro was performed.

## Deliberate history/artifact retention (not misclassified as a handle leak)

### Completed jobs remain in memory for the owning session

- `TaskManager.#tasks` is a session-lifetime map (`src/tasks/task-manager.ts:135-143`). Spawn inserts at `194`; there is no per-task deletion. `jobs.list` and `jobs.inspect` expose completed history (`286-307`; `src/tasks/job-service.ts:239-253`).
- Process references and completion promises are cleared on child close (`src/tasks/task-manager.ts:227-251`), so completed jobs do **not** retain live child handles through `task.process`.
- Output is bounded to 1,000,000 bytes per job (`src/tasks/task-manager.ts:10`, `188`) and `BoundedOutputBuffer` copies/compacts chunks (`src/tasks/output-buffer.ts:35-57,99-123`). Agent completion output adds at most 5,000 bytes (`src/tasks/agent-progress.ts:33`).
- Still, aggregate retention is unbounded in job count. An isolated run of 25 completed commands each producing 1,000,000 bytes left all 25 jobs listed and measured roughly 27.8 MB heap / 27.4 MB external-memory increase on this Bun build after forced GC. The theoretical payload floor is 25 MB; 1,000 such jobs can retain about 1 GB plus metadata.

This appears intentional to support session-local inspection/history, not an accidental lifecycle leak. It is still a resource-exhaustion risk for very long sessions. A count/byte budget with explicit eviction/persistence semantics would bound it.

### Execute spill files persist intentionally, but disk use has no product retention budget

- Output over 4,000 decoded characters spills to a unique directory (`src/typescript/output-capture.ts:8,150-188`) and all subsequent bytes are written to files (`194-232`). Handles are closed in `result()` (`91-104`).
- Paths are returned to the caller (`131-138`), so immediate deletion would break the advertised artifact. Session-backed paths preserve session evidence; no-session paths under `$TMPDIR/die-execute-*` are likewise not removed by product code.

Thus there is no file-descriptor leak, but artifact bytes/directories accumulate without a Die-owned quota or expiry. This is primarily intended evidence retention (and OS temp policy may eventually clean fallback files), not a heap leak.

## Cleanup paths checked and found bounded

- Session shutdown disposes completion timers and attention scheduling, awaits manager shutdown, detaches diagnostics, and drops manager/service references: `src/tasks/extension.ts:564-579`.
- `TaskManager` clears per-task timeout/escalation timers on close (`227-232`), uses unref'd timeout/escalation timers (`263-268,424-427`), and bounds shutdown waiting with a watchdog that destroys streams/unrefs a non-closing child (`431-479`).
- `foreground()` removes its timeout and abort listener in `finally` (`src/tasks/task-manager.ts:320-384`). Delivery ACK/disconnect listeners clean each other (`347-371`); their delayed bridge lifetime is covered in finding 1.
- `JobAttentionScheduler` uses one unref'd deadline timer, deletes per-job state on completion, removes its manager subscription, clears timer/maps, and resolves waiters on dispose: `src/tasks/job-attention.ts:13-25,148-172,174-193,219-245`.
- `CompletionBatcher.dispose` clears both timers and queued notification objects: `src/tasks/completion-batcher.ts:44-50`.
- TUI `TaskMonitorPanel.dispose` unsubscribes and clears its timeout/interval: `src/ui/task-monitor.ts:321-327`.
- Isolated execute cleanup aborts bridge work, removes the caller abort listener, clears both timers, and destroys all stdio/extra pipes: `src/typescript/execution.ts:161-179`. Output artifact file handles close before result return as noted above.
- CLI startup monkey-patches are restored in `finally`: `src/cli.ts:175-190`.

## Minor bounded/cumulative observation

`registerExecuteTool` caches one output-padding number per distinct cwd in a process-lifetime `Map` (`src/typescript/extension.ts:27-37`) and does not clear it on session shutdown (`38-46`). In the normal CLI, cwd cardinality is effectively tiny. In an embedder that reuses one extension across arbitrarily many project roots this is technically unbounded, but the retained value is only one string and number per root and is not a meaningful current CLI leak.
