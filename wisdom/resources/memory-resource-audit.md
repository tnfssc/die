> Historical v0.3.4 audit/decision record.
The selected v0.4.0 fixes and current policies are documented in [resource limits](./resource-limits.md) and [disk-backed history](../history/disk-backed-history.md).
Measurements below describe the pre-fix investigation unless stated otherwise.

# Memory and resource audit

Audit date: 2026-09-18.
Die 0.3.4, source commit `f9d3e5c`, Pi 0.85.1, Linux/Bun 1.4.1.
**Investigation only: no product fixes applied.**

**Bottom line:** normal CLI/web connection teardown held up well under stress, but there are reproducible scoped-retention bugs, unbounded history growth, and failure/overload paths worth fixing.
There is no evidence here of a universal idle-server leak.

## Method and scope

Source review plus isolated stress tests cover CLI/RPC session replacement, execute workers, shell/subagent jobs, the web launcher, server subscriptions/provider sessions, and browser resource ownership.
Tests use temporary state, local fake models where needed, and exact owned process IDs.
No existing user server/session was stopped.
Retained heap after GC, file descriptors, listeners, children, and queue/map number of keys are stronger evidence than RSS alone.

Current web pin: `719a76ca1dbf5490f1aa33ffb9966301e02be9a9`, patched checkout `.cache/die-t3code-v0042`.
Current probes verify the pin and canonical `web/t3.patch`.
Initial results from the older `.cache/die-t3code` checkout are clearly marked stale and excluded from current-release conclusions.

## Confirmed cleanup/retention defects

### Execute helper requests retain cancellation state until execute finishes — medium

`src/typescript/job-bridge.ts:488-501,586-620`, `src/typescript/extension.ts:91-102`.

Sequential, already-acknowledged helper calls remain in the bridge request map.
Their composed cancellation listeners also remain attached.
The design defers task-result ownership transfer until the worker exits cleanly, but applies retention even to observational calls such as `jobs.list()`.

**Reproduction:** `bun scripts/leak-audit/bridge-retention.ts` uses the real bridge over owned in-memory streams.
At 10,000 calls: 10,000 listeners and heap 0.86 → 5.87 MiB.
Closing the bridge: zero listeners and 1.41 MiB.
This is unbounded growth **inside one long execute**, not permanent leakage after each execute.

**Remedy:** separate minimal result-ownership commit records from cancellable RPC state.
Retire acknowledged observational/error requests promptly.
Keep the existing crash-safe notification ownership semantics.

### Web launcher cannot guarantee backend process-tree cleanup — medium/high, conditional

`src/web/launcher.ts:87-102` forwards termination only to its direct child, without a dedicated process group or escalation deadline.

**Reproduction:** `bun scripts/leak-audit/web-launcher-runtime.ts` uses controlled backends.
A TERM-ignoring backend keeps the launcher alive.
A backend that exits without cleaning its grandchild leaves that grandchild running after the launcher exits.
All test processes were explicitly cleaned afterward.
This shows a fallback-cleanup defect, **not** that normal web shutdown always leaks.

**Remedy:** explicit owned-process-group lifecycle on POSIX, bounded TERM-to-KILL escalation, and cleanup when the leader exits.
Do not signal unrelated process groups.

### Provider log sinks never retire; aggregate disk retention can be bypassed — medium

Current web `apps/server/src/provider/Layers/EventNdjsonLogger.ts:410-472` creates one sink per thread and keeps it for the service lifetime.
Every retained sink's current file remains marked active, exempting it from aggregate size/age cleanup even after that thread stops.

**Reproduction:** real current-source logger, 100 distinct thread writes, configured total cap 1,024 bytes: **100 sinks, 100 files, 110,890 bytes**, with no pending writes.
This is small metadata retention plus a material disk-policy bug, **not** an open-FD leak.
The production shared logger is server-lifetime.
Individual-file rotation still works.

**Remedy:** retire inactive thread sinks and their active-file exemptions safely.
Repro: `node scripts/leak-audit/current-web-provider.mjs`.

### Failed desktop recording startup retains pending capture callbacks — medium-low, desktop-specific

Current web `apps/web/src/browser/browserRecording.ts:322,356-380,416-443`: if the native capture trigger never arrives, startup times out but the pending capture registration remains.
A test rejected startup via the real timeout, then demonstrated that the failed tab's global trigger still returned true.
Distinct failed tabs can accumulate pending callback/promise state.
A late trigger can start stale work.
This is not the normal browser/CLI path.

**Remedy:** remove/cancel the pending native registration on timeout and every failed-start path.
Repro: `node scripts/leak-audit/current-web-client-tests.mjs`.

### Smaller web lifetime-retention defects — low / low-medium

- **Pi thread locks:** current `PiAdapter.ts:411-423`. 300 rejected starts with repeated stop/stopAll left 300 locks while sessions and leases stayed at zero.
  100 successful fake-provider start/stop cycles closed all 100 clients but retained 100 lock entries.
  Retire keyed locks with waiter-safe ownership, not naive deletion.
- **Pi extension task records:** `PiAdapter.ts:1193-1217`. Three completed/drained turns retained 100 → 200 → 300 finished extension task records.
  Session stop released them.
  **Default Die task projection is capped at 50. This is a separate extension-compatibility path.**
- **Frontend caches, source-confirmed:** arbitrary Markdown language labels stay in `syntaxHighlighting.ts:18-38` even when unsupported. PR handoff caching retains full prompts per draft in `PullRequestDetailPanel.tsx:261,1090-1094`.
  Smaller navigation/error/icon keys also lack eviction.
  No browser retained-heap slope was measured. These are real retention paths but not quantified real-world RAM impact.

## Web backpressure risks — source-confirmed, not full-socket saturation reproductions

**Important:** normal connection churn does not test a connected client that stops consuming output.

Current `apps/server/src/ws.ts:3307-3317,3339-3350` uses `Stream.callback` for terminal output without a buffer limit.
The installed Effect default is unbounded.
Terminal ACK logic caps only the downstream in-flight window (8 chunks / 64 KiB), not the producer queue upstream.
A noisy terminal plus a live stalled/non-ACKing subscriber can accumulate output until disconnect.
A second terminal pending-process-event queue and preview's unbounded PubSub have similar producer/consumer imbalance risks.

**Remedy:** bound bytes/items at the actual producer queue, with explicit pause/disconnect or truncation/replay behavior.
Quiet reconnect tests are not evidence that these overload paths are bounded.
This audit did not measure current full-socket saturation throughput or retained bytes.

Terminal history is separately bounded to 8 MiB / 5,000 lines per session and 128 inactive sessions—still about 1 GiB of possible inactive history.
Active sessions are outside that inactive-count cap.

**Rejected earlier lead:** timed-out preview automation requests are not a current-version leak: current code disconnects the host and shuts down the queue on timeout.
Do not apply the stale-checkout report's claim.

## Intentional retention that can still exhaust resources

These are not orphan leaks, but they matter in long sessions.

| Resource | Evidence | Consequence / direction |
|---|---|---|
| Completed job output | `TaskManager` retains every job; output capped at 1,000,000 bytes **per job**, no total-job budget. 25 completed 1 MB jobs retained about 27 MB. | Roughly 1 GB payload for 1,000 fully buffered jobs. Add an aggregate RAM budget, disk-backed inspection, and explicit eviction metadata. |
| Original session journal | Real `SessionManager` test: four batches totaling 32 MiB text grew heap ~17 → 49 MiB while compaction kept model context at two messages. New session plus settled GC returned heap ~17 MiB. | Compaction is not RAM reclamation. Original history is a product feature; use a lazy disk-backed journal/index rather than silently discarding it. |
| Execute output artifacts | Previews are bounded, complete spill files are not. 24 executions wrote 30 MB of complete artifacts successfully. Timeout is optional. | Disk can fill. Add explicit output quota/truncation semantics and a durable artifact retention policy. |
| Concurrent helper requests | Each frame is bounded, outstanding request count is not. | A single execute can create significant parent-process pressure. Bound concurrency/backpressure; teardown does currently release the requests. |

Journal reproduction: `bun scripts/leak-audit/session-journal.ts`.
Execute capture/lifecycle reproduction: `bun scripts/leak-audit/execution-runtime.ts`.

## Healthy paths / negative results

- **2,000 CLI session replacements:** exactly 9 FDs, 16 threads, zero children. RSS showed GC sawtooth/plateau rather than monotonic accumulation.
- **2,000 mixed CLI turns:** stable 11–12 FDs, 17 threads, zero children. Clean exit.
  RSS still drifted (~110 → 191 MiB cold-to-end), so this run does **not** prove absence of live-object retention.
  Successful native compaction was not exercised. Generic local-provider compaction attempts were cancelled.
- **Execute lifecycle stress:** 8 FDs throughout. 6/6 deliberately pending bridge handlers aborted. 0/10 test descendants survived. RSS increased only 48 KiB over the final 120 normal executions.
- **1,010 normal web-launcher fixture exits:** no retained FDs or SIGINT/SIGTERM listeners.
- **3,000 current-web subscription reconnects under Node with GC instrumentation:** heap ~77.3 → 79.5 MiB settled, only ~0.20 MiB growth from cycle 1,500 to 3,000. FDs declined to idle baseline, watchers stayed at 3, no children remained.
  This is positive reconnect-cleanup evidence, not proof about stalled consumers or the shipped Bun allocator.
- **Actual bundled Bun `dist/die web` v0.3.4:** 600 reconnect cycles plus 64 held subscriptions. All held FDs released, 21 threads unchanged, zero backend descendants.
  After quiescence RSS was 294,180 KiB versus 301,204 KiB warmed baseline. FDs 25 → 21.
  All owned process identities stopped.
  RSS is not a heap measurement.
- 68 focused history/UI/bounds tests, 83 execute/bridge/launcher tests, and 728 targeted current-web tests/probes passed.
  TypeScript checking passed after adding the durable audit scripts.

## Smaller findings and limitations

- Cancelling a subagent between session-file preparation and process spawn can leave a small unused JSONL session.
  Source-confirmed. Not a heap leak.
- Rare execute stream-pump rejection can skip artifact handle closure until runtime/GC cleanup. Source-only, not reproduced in normal tests.
- Failed web-settings rename can leave a temporary file. Source-only.
- Windows direct-child termination does not contain descendants.
  No Windows runtime test. Current Linux/macOS release focus makes this lower priority here.
- This is not a multi-day production soak, complete browser heap snapshot study, or exhaustive third-party/native allocator audit.
  No finite test establishes that the application is leak-free.

## Detailed evidence

See `wisdom/resources/leak-audit.md` for the work log. `wisdom/resources/leak-audit-current-web.md` for current-version web detail and source citations. `wisdom/resources/leak-audit-bundled-web.md` for shipped-Bun measurements.
Durable probes live in `scripts/leak-audit/`.
Current-version web probes are named `current-web-*`.
The original `web-runtime-probe.mjs` and `server-shutdown-probe.mjs` target the stale checkout and are historical evidence only.

## Recommended order

1. Bound terminal/preview producer backlogs and aggregate completed-job RAM. These can have the largest practical memory impact.
2. Fix provider-log sink retirement/total disk retention and launcher process-tree fallback cleanup.
3. Release unnecessary execute RPC cancellation state promptly, while preserving ownership/notification correctness.
4. Clean up failed recording registration and cap/retire browser/provider caches.
5. If very long sessions must have flat RAM, design disk-backed original-history access. Compaction alone cannot do that.

After fixes, turn the probes into regression tests and add a longer idle/busy/slow-client soak.
Successful native compaction, a full browser heap investigation, noisy-terminal slow-consumer saturation, and multi-day workloads remain outside the proven coverage.
