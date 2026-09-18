# Current web server leak audit

## Scope and provenance

Audited only the canonical patched tree at `.cache/die-t3code-v0042`.

- base HEAD: `719a76ca1dbf5490f1aa33ffb9966301e02be9a9`
- `git -C .cache/die-t3code-v0042 apply --reverse --check web/t3.patch`: **passed**
- rebuilt server: `.cache/die-t3code-v0042/apps/server/dist/bin.mjs`
- rebuilt bundle SHA-256: `6f34a3aed25784878e3c7bb9b46add628adbbfbb1b83a3af949d8fd6be5bbae2`
- no product source edits; no paid API calls; isolated temporary HOME/XDG/T3CODE_HOME only
- owned server PIDs were 2021234 and 2054460. The probe signals only its direct child and PIDs read from that child's Linux descendant tree. No user server/session was inspected or killed.

Older `leak-audit-web-server.md`, `web-runtime.md`, and the old `.cache/die-t3code` runtime were not used as evidence.

## Verdict

No file-descriptor, task, child-process, WebSocket subscription, or connection-accounting leak reproduced under 3,000 sequential authenticated WebSocket subscribe/disconnect cycles. Heap growth was front-loaded and substantially flattened in the second half; this does **not** reproduce a linear per-connection leak.

Three source-only retention risks remain:

1. **Confirmed unbounded key retention: terminal per-thread locks.** `threadLocksRef` is a server-lifetime `Map<string, Semaphore>`; `getThreadSemaphore` inserts every distinct thread ID, and there is no deletion path. Terminal session eviction/close does not remove these keys. A workload touching unbounded thread IDs therefore retains one semaphore and key per thread until server shutdown. Refs: `apps/server/src/terminal/Manager.ts:1529`, `:1558-1580`, versus close/eviction at `:1957-1983` and `:2317-2355`. **Source-only; not runtime-quantified** because this state is private and the black-box probe did not manufacture user terminals.

2. **Unbounded transient PTY process-event buffer.** Each terminal has `pendingProcessEvents: Array<PendingProcessEvent>`; synchronous PTY callbacks push without a byte/event ceiling, while one asynchronous drain fiber performs history persistence and event publication. A producer outrunning the drain can grow memory until caught up. Cleanup correctly clears it on stop/exit/error, so this is pressure/backlog retention rather than abandoned-session retention. Refs: `Manager.ts:261-286`, `:450-465`, `:1987-2099`, `:2230-2242`. **Source-only; existing tests establish history bounds, not a bound on this pending queue.**

3. **Unbounded VCS cwd caches/locks.** `VcsStatusBroadcaster` keeps a server-lifetime status `Map` and a server-lifetime `remoteWriteLocks` map. Every distinct normalized cwd can add entries; poller demand is released, but status and semaphore entries are not removed. Refs: `apps/server/src/vcs/VcsStatusBroadcaster.ts:233-246`, cache writes at `:254-340`, poller release at `:655-695`. **Source-only; not a connection-churn finding.**

## Runtime evidence (tested)

### Mixed lifecycle run

Artifact: `.agents/notes/leak-audit-current-web-server-results.json`.

Workload: 10 warmups, 300 HTTP requests, 600 sequential subscribed sockets, 400 sockets in concurrent rounds, then 80 simultaneously held subscribed sockets. Every socket used a fresh authenticated WebSocket ticket and opened `subscribeServerConfig` before close.

- baseline after forced GC: heap 81,061,064 B; fd 39; tasks 12
- after 600 sequential: heap 83,449,152 B; fd 37; tasks 12
- while 80 held: heap 99,046,072 B; fd 150
- after close + 5 s quiescence + forced GC: heap 83,277,392 B; fd 34; tasks 12; sockets 2
- descendants at every sample: none
- errors: none; subscription frames: 1,090

The held-connection heap increase (~15.6 MB) was released to within ~0.23 MB of the pre-held post-churn point. FDs dropped below baseline after keep-alive/inspector quiescence.

### Long sequential run

Artifact: `.agents/notes/leak-audit-current-web-server-3000-results.json`.

Workload: 3,000 sequential authenticated subscribed sockets, forced GC at checkpoints.

- baseline: heap 81,066,224 B; fd 39; tasks 12
- 1,500: heap 83,386,648 B; fd 37; tasks 12
- 3,000: heap 83,597,536 B; fd 37; tasks 12
- quiescent: heap 83,396,016 B; fd 34; tasks 12; sockets 2; descendants none

First-half heap delta was +2,320,424 B; second-half delta was only +210,888 B (about 9% of first-half growth). Stable descriptors/tasks and the flattening forced-GC heap curve argue against linear connection or subscription retention.

### Current source tests

Command run in the canonical tree:

`vp test run apps/server/src/terminal/Manager.test.ts apps/server/src/terminal/NodePtyAdapter.test.ts apps/server/src/terminal/BunPtyAdapter.test.ts apps/server/src/terminal/OutputProtocol.test.ts apps/server/src/auth/SessionStore.test.ts`

Result: **5 files passed, 120 tests passed**. This covers real current source terminal session/history/process teardown, PTY adapter cleanup, output-window behavior, and auth connection accounting. It is not evidence for the three source-only risks above.

## Source teardown/bounds review

- WebSocket scope: per-connection RPC protocol is `forkScoped`; `markConnected`/`markDisconnected` are paired by `acquireUseRelease` (`apps/server/src/ws.ts:3715-3767`).
- Connection counts: disconnect decrements and deletes at zero (`auth/SessionStore.ts:566-645`).
- Terminal stream listeners: RPC handlers wrap attach/event/metadata subscriptions in `acquireRelease` (`ws.ts:3307-3358`); manager unsubscribe removes callbacks (`terminal/Manager.ts:2722-2727`).
- Terminal history is bounded to 5,000 lines and 8 MiB per retained session; inactive sessions are capped at 128 (`Manager.ts:92-100`, `:1957-1983`). This is bounded but permits a large theoretical retained-history ceiling (~1 GiB) before object overhead; running sessions are intentionally not included in the inactive cap.
- PTY data/exit handlers are unsubscribed on cleanup (`Manager.ts:443-448`); kill-escalation fibers remove themselves (`:1665-1685`); manager finalization closes its worker scope and cleans live sessions (`:2490-2517`).
- Terminal wire output windows are per-WebSocket protocol wrappers and delete per-request state on `Exit` (`terminal/OutputProtocol.ts:10-55`). Abrupt socket closure drops the whole per-connection wrapper; runtime churn did not retain handles linearly.
- VCS poller subscription demand has an explicit retain/release pair and interruption (`VcsStatusBroadcaster.ts:606-725`), but that cleanup does not cover the status/lock maps called out above.
- Server-lifetime PubSubs are scope-shutdown where explicitly acquired, and `Stream.fromPubSub`/`Stream.fromSubscription` subscriptions are scope-bound. No orphan subscriber was reproduced. Several buses are intentionally `PubSub.unbounded`; slow still-connected consumers can therefore accumulate backlog. **Source-only pressure risk, not a demonstrated post-disconnect leak.** Examples: `auth/SessionStore.ts:489`, `orchestration/Layers/RuntimeReceiptBus.ts:28`, `serverLifecycleEvents.ts:28`.

## Durable repro

- `scripts/leak-audit/current-web-server-check.sh`: verifies exact HEAD and reverse-check, runs targeted current-source tests, rebuilds the canonical server, then launches the isolated probe.
- `scripts/leak-audit/current-web-server-runtime.mjs`: refuses the wrong HEAD/reverse-check, records bundle hash, uses temporary state, forced-GC/process samples, and exact owned-PID cleanup.

Useful overrides: `LEAK_SEQUENTIAL`, `LEAK_CONCURRENT_ROUNDS`, `LEAK_CONCURRENT_WIDTH`, `LEAK_HELD`, `LEAK_HTTP`, `LEAK_OUTPUT`, and `LEAK_KEEP_STATE=1`.
