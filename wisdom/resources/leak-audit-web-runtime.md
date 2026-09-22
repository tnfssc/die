> **STALE CHECKOUT:** Measurements below are for 6f00d388, not current pin 719a76ca. Current evidence lives in `leak-audit-current-web.md` and its current-server JSON files.

# Web server runtime leak audit

## Scope and verdict

Black-box/runtime audit of `.cache/die-t3code/apps/server` at commit `6f00d3881a197dd33c2cb43c6a11a9e759e56089`, using Node 24.15.0 on Linux 7.0.3. I did not edit product code and did not use a paid model/provider call.

**Verdict: no deterministic FD, listener, process, or WebSocket-scope leak reproduced.** All connection-owned sockets, requests, and provider-probe child processes returned to baseline after a five-second quiescence period. Forced-GC heap did retain a small, diminishing amount after first-use churn: **+5.17 MiB after 3,000 authenticated connect + subscription + interrupt + close cycles**, with only **+1.22 MiB in the second 1,500 cycles**. This is not enough to call a leak: it is sublinear in this run and is consistent with lazy/JIT/cache high-water behavior. It is worth tracking in a longer soak because it did not return fully to the early warm-up baseline.

## Isolation and safety

- Every server used a fresh `mkdtemp` directory for `HOME`, `T3CODE_HOME`, XDG state/config/cache, cwd, sqlite, logs, and secrets.
- Every run reserved a loopback-only free port and bound `127.0.0.1`.
- The probe directly spawned one known server PID. Cleanup signals only that PID and exact descendants discovered under `/proc/<pid>/.../children`; no `pkill`, `killall`, process-name matching, or interaction with the user's server.
- Web auth was realistic: `serve` generated an isolated pairing credential, OAuth token exchange created one test client, and every connection minted a one-use WebSocket ticket.
- The only RPC workload was `subscribeServerConfig`. It receives the initial stream frame, sends Effect RPC `Interrupt`, then closes. It can run local provider inventory/version probes but cannot submit a prompt.
- The server ran with `--expose-gc --inspect=127.0.0.1:0`. Samples invoke V8 heap GC multiple times before reading `process.memoryUsage()`. RSS/PSS are reported only as allocator/OS context, not treated as proof of a leak.

## Reproducers

- `scripts/leak-audit/web-runtime-probe.mjs`: isolated authenticated HTTP/WebSocket stress probe, GC heap samples, active handles/requests/resources, Linux FD/task/descendant counts, PSS/private-dirty context, exact-PID cleanup.
- `scripts/leak-audit/server-shutdown-probe.mjs`: isolated SIGTERM/SIGINT lifecycle timing probe.

Main commands used:

```sh
# 1,500 authenticated handshakes, no RPC subscription
LEAK_SEQUENTIAL=1500 LEAK_CONCURRENT_ROUNDS=0 LEAK_CONCURRENT_WIDTH=0 \
  LEAK_HELD=0 LEAK_HTTP=0 LEAK_SUBSCRIBE=0 \
  LEAK_OUTPUT=wisdom/resources/leak-audit-web-runtime-handshake.json \
  node scripts/leak-audit/web-runtime-probe.mjs

# 3,000 connect/subscribe/interrupt/close cycles
LEAK_SEQUENTIAL=3000 LEAK_CONCURRENT_ROUNDS=0 LEAK_CONCURRENT_WIDTH=0 \
  LEAK_HELD=0 LEAK_HTTP=0 LEAK_SUBSCRIBE=1 \
  LEAK_OUTPUT=wisdom/resources/leak-audit-web-runtime-subscriptions-3000.json \
  node scripts/leak-audit/web-runtime-probe.mjs

# 400 connections in batches of 20, then 80 held concurrently and closed
LEAK_SEQUENTIAL=0 LEAK_CONCURRENT_ROUNDS=20 LEAK_CONCURRENT_WIDTH=20 \
  LEAK_HELD=80 LEAK_HTTP=0 LEAK_SUBSCRIBE=1 \
  LEAK_OUTPUT=wisdom/resources/leak-audit-web-runtime-concurrent.json \
  node scripts/leak-audit/web-runtime-probe.mjs

node scripts/leak-audit/server-shutdown-probe.mjs SIGTERM
node scripts/leak-audit/server-shutdown-probe.mjs SIGINT
```

The probe defaults are a mixed run (300 HTTP fetches, 600 sequential subscription reconnects, 400 concurrent reconnects, 80 held subscriptions). Raw result files are alongside this report.

## Measurements

### Sequential lifecycle

All heap values below are V8 `heapUsed` after explicit GC. Deltas use each fresh process's post-warm-up baseline.

| workload | checkpoint | heap delta | FD delta | active server/socket state |
|---|---:|---:|---:|---|
| handshake only | 750 closes | +3.03 MiB | -2 | 1 Server, 3 Socket, 3 FSWatcher |
| handshake only | 1,500 closes | +1.88 MiB | -2 | unchanged |
| handshake only | 5s quiescent | +1.83 MiB | -3 | 1 Server, 2 Socket, 3 FSWatcher |
| config subscription | 750 closes | +3.72 MiB | -2 | 1 Server, 3 Socket, 3 FSWatcher |
| config subscription | 1,500 closes | +4.54 MiB | -2 | unchanged |
| config subscription, independent long run | 1,500 closes | +4.40 MiB | -2 | unchanged |
| config subscription, independent long run | 3,000 closes | +5.62 MiB | -2 | unchanged |
| config subscription, 5s quiescent | 3,000 closes | **+5.17 MiB** | **-5** | **1 Server, 2 Socket, 3 FSWatcher; no requests/children** |

Interpretation:

- A per-connection FD/listener leak is ruled out at this scale: FD count decreased from 39 warm to 34 quiescent, and the active handle composition returned to the fixed server/watchers plus inspector/control sockets.
- External/ArrayBuffer memory returned to approximately 26.1 MiB / 0.10 MiB, ruling out retained WebSocket frame buffers in this workload.
- The heap trajectory is not linear: +4.40 MiB in the first 1,500 cycles, +1.22 MiB in the next 1,500, then -0.32 MiB after quiescence. This looks like warm-up/high-water caching, but the remaining +5.17 MiB is the one unresolved retention signal.
- Linux private dirty grew about 16.6 MiB in the 3,000-cycle process while forced-GC heap grew 5.17 MiB. This is compatible with V8/native allocator committed pages and is **not** independently classified as a leak.

### Concurrent and held subscriptions

- After 400 connections in 20-wide batches, the immediate forced-GC heap delta was +4.94 MiB.
- With 80 live subscriptions, expected transient state appeared: 132 Socket handles, 167 FDs, ~101.8 MiB forced-GC heap, and transient provider-probe child processes.
- Roughly 0.6s after closing all 80, 46 Socket handles/81 FDs remained, demonstrating that an immediate post-close count is misleading.
- After five seconds: **2 Socket handles, 34 FDs, no active requests, no child processes**, below the warm baseline of 3 Socket handles/39 FDs. Heap was +3.13 MiB over warm baseline.
- This specifically found no retained listener, subscription socket, RPC request, or provider subprocess after close/quiescence.

### HTTP mixed run

The mixed run issued 300 parallelized static HTTP fetches. Immediately afterward the HTTP client's keep-alive pool left 20 server-side TCP sockets (58 FDs total); later WebSocket checkpoints returned to 37 FDs. This is connection pooling, not monotonic retention.

### Process shutdown

On fresh isolated servers:

| signal | exit latency | result |
|---|---:|---|
| SIGTERM | 1,788 ms | exited normally through CLI handler, code 130 |
| SIGINT | 797 ms | exited normally through CLI handler, code 130 |

No exact child PID remained after either probe.

## Provider session and thread cleanup coverage

Launching a real paid provider session was intentionally excluded. I exercised the strongest deterministic mock-backed lifecycle tests instead:

- `OpenCodeServerOwner.test.ts` + scoped ProviderRegistry cases: **4 passed** (concurrent borrower sharing/idle close, owner-scope shutdown, interrupted borrower release, timed-out provider probe scope close).
- Focused `OpenCodeAdapter.test.ts` lifecycle cases: **5 passed** (interrupted connecting startup, `stopAll` release, throwing cleanup finalizer, event-stream closure on scope close, abort-timeout waiter release).
- Focused `server.test.ts` archive/deletion cleanup cases: **6 passed** (provider session stop, terminal close despite failures/defects, no-session archive, recreated-thread deletion drain, failed cleanup reporting).

Total focused lifecycle assertions: **15 passed, 0 failed**. These tests use service/mocked provider layers and make no paid calls.

## Findings and follow-up

1. **No confirmed runtime lifecycle leak** in the tested server paths. Connection scopes, subscription resources, FDs, requests, and subprocesses clean up.
2. **Low-confidence residual heap signal:** post-GC heap remained +5.17 MiB after 3,000 subscription reconnects. The falling marginal slope (about 3.1 KiB/cycle first half versus 0.85 KiB/cycle second half) argues against simple per-connection retention, but a 10k–50k same-process soak or baseline/end heap-snapshot dominator diff would settle whether it plateaus.
3. **Measurement pitfall:** checking immediately after WebSocket close falsely looks like an FD leak (81 FDs); five seconds later it was 34. Any CI guard should include quiescence and GC and should assert handle/FD return, not RSS.
4. Provider status subscription can transiently spawn local provider probes. The observed descendants disappeared before the quiescent sample; no process leak reproduced.

## Artifacts

- `wisdom/resources/leak-audit-web-runtime-results.json` — mixed run
- `wisdom/resources/leak-audit-web-runtime-handshake.json` — 1,500 handshake-only cycles
- `wisdom/resources/leak-audit-web-runtime-subscriptions.json` — 1,500 subscription cycles
- `wisdom/resources/leak-audit-web-runtime-subscriptions-3000.json` — 3,000 subscription cycles
- `wisdom/resources/leak-audit-web-runtime-concurrent.json` — concurrent/held lifecycle run
