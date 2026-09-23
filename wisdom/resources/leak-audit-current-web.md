# Corrected current-version web memory/resource audit

## Provenance and scope

**Only current source is evidence here.** Canonical patched checkout: .cache/die-t3code-v0042.

- web/t3-source.json and checkout HEAD: **719a76ca1dbf5490f1aa33ffb9966301e02be9a9**.
- Canonical patch reverse check passed before work and after probes: git -C .cache/die-t3code-v0042 apply --reverse --check "$PWD/web/t3.patch".
- web/t3.patch SHA-256: **44232094ab522c0c118dc7f2a742f2a6137bfb48e03b90187b57e52afd359576**.
- Rebuilt current server bundle SHA-256: **6f34a3aed25784878e3c7bb9b46add628adbbfbb1b83a3af949d8fd6be5bbae2**.
- Two workers covered frontend/client-runtime and server/connection/terminal runtime. Orchestrator covered provider sessions, logger retention and cross-checks.
- No product edits, paid APIs, or signals to user processes.
  Tests used fake providers/current source services and isolated server HOME/XDG/T3CODE_HOME.
  Exact owned server/descendant PIDs only, with PID-start-time checks.
  Temporary test copies were removed.
- Older reports were leads only.
  The old preview-timeout backlog claim is **not true of current source**, as detailed below.

Source paths below are relative to this checkout.
Detailed companion reports in this directory: leak-audit-current-web-client.md, leak-audit-current-web-server.md, leak-audit-current-web-provider.md.

## Executive conclusion

**No linear connection/subscription, FD, task, or child-process leak reproduced in 3,000 authenticated WebSocket subscribe/disconnect cycles.** This is not a clean bill of health for all web state: specific frontend failure-path retention and provider/logger growth were reproduced.
Several high-number of keys caches and producer backlogs remain.

Priorities: cancel stale desktop recording captures.
Bound terminal producer-to-consumer buffering rather than just its ACK window.
Retire provider log sinks/old active-file exemptions.
Bound high-number of keys frontend and extension caches.
Small semaphore/timestamp maps are lower priority.

## Reproduced current-source retention

### 1. Desktop recording startup timeout retains pending native capture — medium-low

apps/web/src/browser/browserRecording.ts:322 registers pendingTabMediaCaptures.
Timeout cleanup at 356-380 clears only the timer.
Failed-start cleanup at 416-443 does not remove/cancel the capture.

The current harness simulates native requestDisplayMediaCapture returning without invoking its global trigger. startBrowserRecording rejects after its real configured timeout.
Invoking the trigger for that failed tab still returns **true**, proving the private pending-capture entry survived.
Distinct failed tabs can retain callback/promise state for page lifetime. A late trigger can initiate stale capture work.
Normal media teardown is otherwise tested.

Repro: node scripts/leak-audit/current-web-client-tests.mjs (missing-native-trigger test).

### 2. Pi per-thread semaphores survive sessions and rejected starts — low

apps/server/src/provider/Layers/PiAdapter.ts:411-423 memoizes locks. startSession acquires one before mode validation (1859 onward).
stopSession/stopAll (2397-2401) never retire locks.

Real source-copy instrumentation with read-only observers:
- Unique rejected starts, stopSession each, stopAll every 100: **locks 100 → 200 → 300. Sessions=0. Leases=0. Zero process spawns**.
- 100 successful fake-provider start/stop cycles: **locks=100. Sessions=0. Leases=0. Client.close called 100 times**.

Service-lifetime small-key retention, not a live-process leak.
Naive lock deletion while callers wait would break serialization.

### 3. Completed Pi extension-subagent records survive turns — low/medium, extension-specific

PiAdapter.ts:1193-1217 retains extensionSubagentTasks by unique toolCallId+index.
Completion changes state.
No deletion/clear exists.
Three fully settled fake-provider turns, output actively consumed, retained **100 → 200 → 300 completed records**, with 1,000-character descriptions. stopAll released the owning session.
Adjacent workflowTasks has the same no-delete source shape (1298-1365), not separately reproduced.

**Not default die job history:** dieTasksById is correctly bounded at 50, with bounded descriptions/summaries (148-150,1515-1521).
This affects Pi extension compatibility paths in long-lived sessions.

### 4. Provider logger retains every thread sink and exempts its files from aggregate retention — low memory, material disk risk

EventNdjsonLogger.ts:410-435 creates a RotatingFileSink per thread segment.
Only write failure deletes it (456).
Retention considers every ever-created sink file active (468-472), and active files cannot be deleted (314-324).
ProviderEventLoggers.ts creates one shared server-lifetime store.

Real current logger test: 100 unique thread writes, batchWindowMs=0, test-clock advances before every write, maxTotalBytes=1024.
Observed **sinks=100.
Pending=0.
Files=100.
Bytes=110890**.
No thread-ended API retires sinks.
Individual-file rotation stays bounded.
Aggregate ever-used active-file retention does not.
RotatingFileSink retains small metadata, **not open descriptors** (packages/shared/src/logging.ts:44-95).

Repro for 2–4: node scripts/leak-audit/current-web-provider.mjs.
Verifies pin+patch.
Copies exact current source/harness into an owned temporary directory, adds only read-only state observers, cleans up copies.
**4 custom tests passed.**

## Source-confirmed risks, not full runtime reproductions

### Frontend caches

- **Syntax cache DOES exist at this pin.** apps/web/src/lib/syntaxHighlighting.ts:18-38 stores promises by arbitrary language labels.
  Unsupported labels fall back to text but retain original keys. Markdown code fences reach it (ChatMarkdown.tsx:1084).
  Existing behavior test passes. No browser heap slope measured.
  Medium-low priority.
- PullRequestDetailPanel.tsx:261,1090-1094 retains full handoff prompts per draft indefinitely.
  Source-only, potentially larger entries.
- Smaller module-lifetime keys: useLiveRefresh.ts:78-85,136-152. ThreadErrorBanner.tsx:7-33 (includes complete error text). ChatView.logic.ts:1025-1059. ChatMarkdown.tsx:1241-1271 failed favicon hosts. MessagesTimeline.tsx:3704-3759 native tool icon keys/URLs.
  No heap quantification. See client report.

### Terminal producer buffering — important pressure risk

- apps/server/src/ws.ts:3307-3317 and 3339-3350 create terminal streams via Stream.callback with **no bufferSize**.
  Current installed Effect Stream.ts:668-670 explicitly defines the default as **unbounded**.
  Manager listeners offer each terminal event into this callback queue.
- terminal/OutputProtocol.ts:5-9,41-64 caps downstream unacknowledged chunks at 8 / 64 KiB.
  It does **not** cap the upstream callback queue.
  A noisy PTY plus a connected non-ACKing consumer can retain continuing output until disconnect.
  Quiet connection churn below did not test this workload. No current full-socket retained-byte number is claimed.
- Separate pendingProcessEvents queue in terminal/Manager.ts:261-286,450-465,1987-2099 has no cap while async history/event processing drains it.
  Stop/error clears it (2230-2242).
  Backlog risk, not abandoned-session retention.
- History itself is bounded: 5,000 lines / 8 MiB per retained session. 128 inactive sessions.
  This still permits roughly 1 GiB inactive history before overhead.
  Running sessions are intentionally outside that count.

### Server keys, preview, malformed provider output

- Terminal Manager.ts:1529,1558-1580 retains locks per distinct thread, even closing unknown IDs.
  Source-only. Pi equivalent is reproduced above.
- VcsStatusBroadcaster.ts:233-246,254-340 retains cwd status/remote-write locks. Releasing demand stops pollers but not these keys (655-695).
- CursorAdapter.ts:345,376-396 similarly memoizes semaphores (nondefault provider, source-only).
- preview/Manager.ts:157-174 uses PubSub.unbounded.
  Departed subscriptions are scoped. A stalled live subscriber can accumulate backlog.
  Unbounded buses are not automatically post-disconnect leaks.
- mcp/PreviewAutomationBroker.ts:116-145,161-162,459-535 retains successful host assignments keyed by environment+providerSessionId until the host disconnects/replaces.
  No provider-session-ended hook.
  Small source-only records during a long-lived successful desktop connection.
- provider/pi/PiRpcClient.ts:116,225-252 only limits unfinished stdout lines when maxLineLength is set. PiAdapter does not set it.
  Malformed local-child output without newlines can grow remainder.
  No normal RPC leak reproduced. Stderr is drained.

## Corrected exclusions and cleanup checks

- **Do not carry forward timed-out preview request accumulation.** Current PreviewAutomationBroker.ts:576-584 disconnects the host on timeout. Disconnect (339-349) removes pending requests/assignments. closeConnection shuts down the queue (326-336).
  Broker/preview suites passed **52 tests in 2 files**.
  Successful-session assignment retention above is distinct.
- WebSocket connected/disconnected accounting is paired with acquireUseRelease. Scope owns protocol/subscriptions (ws.ts:3715-3767).
  SessionStore deletes zero counters (566-645).
- Client-runtime RPC scopes/fibers and bounded subscriptions passed tests.
  Project favicon cache has capacity/age pruning.
  No extra accumulating listener/socket/decoder/terminal surface/upload-job/object-URL path established outside recording timeout.
- Pi successful session/lease cleanup is directly reproduced.
  Codex map deletion, runtime/scope closure and fiber interruption exist (CodexAdapter.ts:2666-2709). Runtime closes queues (CodexSessionRuntime.ts:2405-2424).
  Compaction/analytics/MCP state has cleanup. Idle reaper correctly distinguishes active/background work.

## Isolated built-server evidence

Artifacts: leak-audit-current-web-server-results.json and leak-audit-current-web-server-3000-results.json.

- 3,000 sequential authenticated subscribeServerConfig sockets with close and forced-GC checkpoints.
- Heap: baseline **81,066,224 B**. 1,500 **83,386,648 B**. 3,000 **83,597,536 B**. Quiescent **83,396,016 B**.
  Second-half growth **210,888 B**, about 9% of first-half growth: not linear.
- FDs: **39 → 37 → 34** after quiescence.
  Tasks **12** throughout. Descendants **none**.
- Mixed run also covered 300 HTTP requests, 600 sequential sockets, 400 concurrent-round sockets, 80 held subscriptions.
  Holding 80 raised heap to about 99 MB. Releasing returned to 83.28 MB, within 0.23 MB of pre-held post-churn.
  No errors.
- These are connection lifecycle workloads, not terminal-output saturation, preview-action saturation, browser heap snapshots, or paid provider runs.

## Durable entry points / executed tests

From repository root:

1. node scripts/leak-audit/current-web-client-tests.mjs — current pin/patch check. **web 9 files/172 tests, client-runtime 5 files/76 tests**.
  Re-run after relocating worker artifacts to durable root paths passed.
  Temporary test uses exclusive creation and finally cleanup.
2. node scripts/leak-audit/current-web-provider.mjs — **4 current-source-copy retention tests**.
3. bash scripts/leak-audit/current-web-provider-tests.sh — **8 files/304 tests**: Pi RPC/adapter, Codex adapter/runtime, ProviderService, session directory/reaper, logger.
4. bash scripts/leak-audit/current-web-server-check.sh — pin+patch checks, **5 source files/120 tests**, rebuild, isolated runtime probe.
5. node scripts/leak-audit/current-web-server-runtime.mjs — isolated current built-server probe. LEAK_SEQUENTIAL=3000 selects long run.
  See server report for tuning.
6. Additional current apps/server command: ../../node_modules/.bin/vp test run src/mcp/PreviewAutomationBroker.test.ts src/preview/Manager.test.ts — **2 files/52 tests**.

No older-checkout measurements are included in these conclusions.
