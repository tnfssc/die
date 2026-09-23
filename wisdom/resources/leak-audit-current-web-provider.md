# Current web provider lifecycle audit

Target verified before tests: .cache/die-t3code-v0042 HEAD = web/t3-source.json = 719a76ca1dbf5490f1aa33ffb9966301e02be9a9. Canonical web/t3.patch reverse check succeeds. All references below are relative to this checkout. No product edits or paid calls.

## Reproduced

### Low: Pi adapter retains one semaphore per distinct thread, even rejected starts

apps/server/src/provider/Layers/PiAdapter.ts:411-423 memoizes locks, with no delete/clear. startSession obtains the lock before runtime-mode validation (1859 onward). SendTurn also locks. stopSession/stopAll (2397-2401) close sessions but never retire locks. Server/provider instance lifetime growth, not an active-session count.

Durable repro: node scripts/leak-audit/current-web-provider.mjs. It checks pin + canonical reverse patch. Creates instrumented copies of real current PiAdapter and its fake-client test harness ONLY in an owned /tmp directory. Two read-only observers expose actual private map sizes. No synthetic reimplementation. All temporary copies are removed.

- 300 rejected starts, stopSession on each, stopAll after each 100: locks 100 → 200 → 300, sessions=0, leases=0 throughout; no child spawned.
- 100 successful start/stop cycles: locks=100, sessions=0, leases=0; fake-client close called exactly 100 times. Event stream actively drained.
- Small entries, low severity. Removing a lock naively while callers wait would break serialization; remediation needs lifecycle-safe keyed locking, not arbitrary deletion.

### Low/medium: completed Pi extension-subagent records survive turns for session lifetime

PiAdapter.ts:1193-1217 inserts extensionSubagentTasks keyed by unique toolCallId+index. Completion only changes state. No delete or clear exists. Records retain task description/title/model/etc. Session close removes the owning context, so this is growth inside a long-lived provider session, not after it stops. Adjacent workflowTasks follows the same source-only pattern (1298-1365).

Same repro feeds real current adapter fake native tool_execution_end events, consumes the projected event stream through turn.completed, and keeps the session open across three fully settled turns: extensionTasks 100 → 200 → 300. Descriptions are 1,000 chars each. After stopAll the session observer is empty. This path is for supported Pi extensions. Default die jobs instead use dieTasksById, which IS capped at 50, with bounded descriptions/summaries (148-150,1515-1521). Do not conflate extension compatibility retention with default die job traffic.

### Low memory / meaningful disk retention: provider event logger never retires thread sinks

EventNdjsonLogger.ts:410-435 memoizes a RotatingFileSink per thread segment. Only a write failure deletes a sink (456). There is no thread-ended API. Every sink's file is classified active during retention (468-472), so successfully written old thread files remain exempt from age and total-byte cleanup for the store/server lifetime. RotatingFileSink is a small metadata object, not an open descriptor (packages/shared/src/logging.ts:44-95).

Same source-copy runner instruments the real logger state, writes 100 unique threads with batchWindowMs=0, maxTotalBytes=1024 and test-clock advances ensuring retention runs on each write. Result: sinks=100, pending=0, files=100, bytes=110890 despite a configured 1024-byte total. File rotation still bounds each individual thread segment. The aggregate cap does not bound all ever-used active sinks until server restart. ProviderEventLoggers.ts:38-67 constructs one shared store and closes it at server scope shutdown. This affects normal canonical provider events, not only debug logging.

## Cleanup checks and tests

- Pi sessions and file leases are removed on close (725-729); scope owns RPC process/reader. PiRpcClient pending RPCs remove on response, timeout, error/interruption (157-170,201-208,276-310); close is scope-finalized (316-327). stderr is drained (262). No retained pending-request issue reproduced.
- PiRpcClient stdout remainder has an optional maxLineLength only (116,225-252); PiAdapter does not supply it. A provider emitting indefinitely without newline can grow remainder until process/session close. Source-only malformed/local-child risk, not a normal observed leak.
- Pi native event transport and adapter output queues are unbounded. This is overload/backpressure risk, not evidence that normal completed queues remain alive. Session stop removes owners; consumer scope management is present.
- CodexAdapter stops by deleting map entry, runtime.close, scope.close, event-fiber interrupt (2666-2709). Token-usage map resets per turn (2330). Codex runtime closes process scope and both queues (2405-2424).
- CursorAdapter's per-thread semaphore memoization also has no deletion (345,376-396); source-only, nondefault provider.
- ProviderService cleans pending compactions in ensuring (1845-1905), turn analytics on terminal/session paths and stopAll (531 onward,1133,2069,2324-2330), and clears MCP credentials on stop. Idle session reaper skips active turns/background work and stops truly idle sessions. No missing basic provider teardown found.

Current source suites executed with apps/server ../../node_modules/.bin/vp test run:
- CodexAdapter, CodexSessionRuntime, ProviderSessionReaper, ProviderSessionDirectory: **120 passed**, 4 files.
- PiAdapter, provider/pi/PiRpcClient, ProviderService: **168 passed**, 3 files.
- Custom source-copy retention probe: **4 passed**, 1 file.

A combined durable run via bash scripts/leak-audit/current-web-provider-tests.sh additionally included EventNdjsonLogger: **304 passed in 8 files**.

These are mock/service-level runtime tests, not a paid-provider run or browser heap measurement. Logs during this audit: /tmp/die-current-provider-tests.log, /tmp/die-current-pi-tests.log, /tmp/die-current-provider-probe.log. Durable runner reproduces custom findings. Source suites can be repeated as above.
