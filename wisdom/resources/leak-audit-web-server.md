> **STALE CHECKOUT AUDIT:** This report inspected `.cache/die-t3code` at 6f00d388, not the current release pin. Do not treat findings as current-release evidence until revalidated in `leak-audit-current-web.md` using `.cache/die-t3code-v0042` (719a76ca).

# Web server memory/resource leak audit

Scope: `.cache/die-t3code/apps/server/src` as produced by canonical integration `web/t3.patch`. Focused on server-side WebSocket connection/session/process cleanup and unbounded listeners, timers, and collections. CLI/job and web-frontend ownership were intentionally excluded. No product files were changed. Line numbers below are from the patched source currently in the cache.

## Findings

### 1. High — terminal RPC streams buffer output without limit behind the ACK window

**Locations**

- `apps/server/src/ws.ts:3038-3046` (`terminalAttach`)
- `apps/server/src/ws.ts:3069-3077` (`subscribeTerminalEvents`)
- `apps/server/src/terminal/Manager.ts:1530-1538, 2722-2728` (listeners synchronously receive every terminal event)
- `apps/server/src/terminal/OutputProtocol.ts:5-9, 41-64` (downstream window only)

Both terminal streams are constructed with `Stream.callback(...)` and no `bufferSize`/strategy. In the installed Effect version that means an **unbounded** callback queue. The manager's listener calls `Queue.offer(queue, event)`, which completes immediately and therefore does not propagate a stalled WebSocket consumer back to the PTY/event producer.

`withTerminalOutputWindow` limits unacknowledged chunks sent by the RPC protocol (8 chunks / 64 KiB), but it is downstream of this unbounded callback queue. Once the window fills, protocol pulls stop while PTY data continues accumulating in the callback queue. The window therefore does not provide an end-to-end memory bound.

**Reachable scenario:** an authenticated WebSocket client starts/attaches to a noisy terminal (for example a command continuously writing output), then remains connected but stops acknowledging stream chunks. The same issue applies to the aggregate terminal-events subscription. Memory grows with terminal output until the request/socket is canceled or the process runs out of memory. A slow/lost client can trigger it accidentally. A credentialed client can trigger it deliberately.

**Evidence:** source inspection is conclusive about the missing bound. An isolated script using the exact installed `Stream.callback` default and the same `Queue.offer` listener shape stalled after its first item, offered 5,000 unique ~2 KiB events in 16 ms, and recovered all 5,000 only when consumption resumed. Measured heap growth was ~5 MiB. This did not involve the user server. The exact output was:

`{"offers":5000,"offerElapsedMs":16,"retainedUntilConsumerResumed":5000,"heapDeltaMiB":5}`

The exact growth for PTY traffic depends on event/chunk sizes and runtime GC, but unbounded retention is not speculative.

### 2. Medium — timed-out preview automation requests remain in an unbounded client queue

**Locations**

- `apps/server/src/mcp/PreviewAutomationBroker.ts:350-365` creates one `Queue.unbounded` per connected host.
- `apps/server/src/mcp/PreviewAutomationBroker.ts:549-582` removes timed-out requests from `state.pending`, but never removes the already-enqueued `request` event from the connection queue.
- `apps/server/src/mcp/PreviewAutomationBroker.ts:390-399` keeps that queue alive for the lifetime of the host stream.
- Reachability from web RPC: `apps/server/src/ws.ts:3119-3135` (preview host connect/respond/focus handlers).

**Reachable scenario:** a desktop preview host establishes its stream and then pauses reading without disconnecting. Provider MCP preview invocations still enqueue request objects. Each invocation eventually times out and its Deferred/pending-map entry is cleaned, but the request object (including input/context strings) remains in the unbounded queue. Concurrent tool calls can enqueue rapidly. Keeping the host connection open retains all stale requests indefinitely.

**Evidence:** an isolated script instantiated the real broker, acquired a host stream, consumed only its `connected` event, then made 2,000 invocations with zero timeout. All invocations timed out, but after resuming the stream all 2,000 stale request events were still present. It completed in 155 ms:

`{"first":"connected","timedOutInvocations":2000,"staleRequestsStillQueued":2000,"elapsedMs":155}`

This is directly reproduced against the patched module with no server process involved.

### 3. Medium — preview event subscriptions have an unbounded per-subscriber backlog

**Locations**

- `apps/server/src/preview/Manager.ts:157-164` creates `PubSub.unbounded<PreviewEvent>()`.
- `apps/server/src/preview/Manager.ts:172-174` deliberately publishes non-blockingly while holding state lock.
- `apps/server/src/ws.ts:3137-3140` exposes the stream to WebSocket clients.

The comment claims that WebSocket clients backpressure on downstream queues, but downstream backpressure cannot bound the PubSub subscriber queue: an unbounded PubSub intentionally lets publication continue while each slow subscriber accumulates events.

**Reachable scenario:** one authenticated client subscribes and stops ACKing/reading while another client repeatedly calls preview navigation, resize, refresh, or status RPCs. Every event is retained for the stalled subscriber until its stream scope closes. Events are individually small, so this is slower than finding 1, but there is no item/byte/age limit.

**Evidence:** definitive from the unbounded PubSub construction and WebSocket exposure. I did not run a full socket reproduction. Actual growth rate depends on preview mutation rate.

### 4. Low — per-thread semaphore maps retain every thread ID for the service lifetime

**Locations**

- Terminal: `apps/server/src/terminal/Manager.ts:1529, 1558-1580`; callers include `3016-3029` (close).
- Web reachability: `apps/server/src/ws.ts:3065-3067`.
- Pi adapter: `apps/server/src/provider/Layers/PiAdapter.ts:411-423`; use sites `1860` and `2114`.

Both services memoize one semaphore per thread ID and never delete entries. Terminal `close` obtains the semaphore even when no session exists, so an authenticated client can submit validly shaped, unique thread IDs to `terminalClose` and grow `threadLocksRef` without creating PTYs. Normal long-running use also retains locks for deleted/finished threads. Pi similarly retains locks for every thread that reaches its start/send paths until the whole adapter layer is closed.

**Evidence:** the maps have only `get`/`set` paths and no delete/eviction. This is a definite lifetime retention issue. Severity is low because each entry is only a thread-ID string plus semaphore, and abuse requires many authenticated RPCs.

### 5. Low — preview host assignments outlive provider sessions

**Locations**

- `apps/server/src/mcp/PreviewAutomationBroker.ts:116-145` assignment storage/removal.
- `apps/server/src/mcp/PreviewAutomationBroker.ts:161-162` keys each assignment by environment + provider-session ID.
- `apps/server/src/mcp/PreviewAutomationBroker.ts:459-535` creates/retains assignments.

An assignment is removed only when its desktop host connection/queue is replaced or disconnected (or found dead during a later invoke). There is no broker API/call from MCP credential revocation or provider-session shutdown to remove a completed provider session's assignment. While a desktop client stays connected, one assignment remains for every provider session that ever used preview automation, including its session key and queue reference.

**Reachable scenario:** a long-lived desktop connection runs many successive provider sessions that each invoke a preview tool once. The assignment map grows monotonically until that desktop reconnects.

**Evidence:** definite missing lifecycle link/removal path by source inspection. Impact is low because assignment records are small and their queue is already retained by the live client record.

## Cleanup paths checked / no finding

- WebSocket auth connection counts use `Effect.acquireUseRelease` (`ws.ts:3498-3502`) and `SessionStore.markDisconnected` decrements/deletes the map entry (`auth/SessionStore.ts:622-645`).
- Preview host disconnect shuts down its queue and fails pending Deferreds (`PreviewAutomationBroker.ts:326-348`).
- Native telemetry pending request maps remove entries in `ensuring` and sidecar processes are scope-managed.
- Pi RPC pending request entries are removed in `ensuring` and the client has a scope finalizer (`provider/pi/PiRpcClient.ts:276-327`).
- Local device hub/daemon have a server-scope finalizer (`device/LocalDeviceHost.ts:679-689`); detached restart supervisors observe `runningRef = null` after stop and do not respawn.
- Service-launcher signal listeners and force-kill timers are removed/cleared in their normal finalization paths (`serviceLauncher.ts:256-309`).

## Notes on certainty

Findings 1, 2, 4, and 5 identify concrete unbounded retention paths. Findings 1 and 2 were additionally reproduced in isolated scripts. Finding 3 is structurally certain, but practical severity depends on how quickly preview mutations are generated while a subscriber is stalled. No claim here depends on observing the user's running server.
