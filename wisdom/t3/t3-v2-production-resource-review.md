# T3-v2 production resource/correctness review

**Status:** independent read-only review of the in-flight production patch (latest snapshot observed 2026-09-21). I did not edit product/experiments/checkout, run builds or shared servers, or access runtime secrets. Implementation remains owned by `task_6de99022`; line numbers below should be rechecked after its edits settle.

## Readiness verdict

**Not production-ready for T3 delegation yet, but now fail-closed rather than leak-prone.** The latest patch deliberately rejects `subagent()` whenever a scoped T3 environment is present (`src/tasks/job-service.ts`) and does not yet connect `T3McpClient` to the job/task lifecycle. This prevents duplicate local fallback but means no production T3 child can launch. The standalone client has a useful 1 MB response cap and response-body cancellation, but it has no owner that cancels/awaits in-flight requests and DELETE-closes the session. Final readiness needs the lifecycle contract and bounded-memory/process-cleanup evidence below.

An earlier in-flight snapshot briefly contained `T3TaskBackend`/external TaskManager adoption. It had deterministic record, polling, and shutdown-order defects. That code was removed before this latest review; those issues are recorded below as rejected-design guardrails, **not current-source findings**.

## High-value findings

### 1. Blocker — confirmed: production delegation is intentionally unavailable

**Path:** `src/tasks/job-service.ts` (T3 environment check in the `subagent` case); `src/tasks/t3-mcp-client.ts` is otherwise only imported by tests.

When both T3 environment values are present, JobService throws “scoped backend contract is not validated” before local spawn. This is the correct safe direction—no duplicate local child—but it is not a production delegation implementation. There is now no owner for MCP session creation/close, task identity, polling/durable result recovery, ACK transfer, cancellation, or shutdown.

**Minimal acceptance:** keep the fail-closed gate until one reviewed backend owns those phases. Do not weaken it to local fallback on transport/auth errors. The backend must use the existing TaskManager/job APIs without adding a second permanent result/output registry.

### 2. High latent risk — confirmed in standalone client: close does not coordinate in-flight requests

**Path:** `src/tasks/t3-mcp-client.ts (`T3McpClient`, especially `initialize`/`callTool`/`close`)`.

`close()` marks the client closed and DELETEs the current session, but it neither aborts nor awaits calls already inside `fetch`/body decode. A future production owner that calls close during initialize/tool work can DELETE while POST is in flight. The POST closure continues to retain the token/client until its 30 s timeout and can return a result after shutdown. The sharpest race is close during the initial POST before `#sessionId` is learned: close sees no session and returns, then initialize can receive/store a session and even send `notifications/initialized` despite `#closed`, with no later DELETE. The present product does not instantiate the client, so this is latent rather than a now reachable leak.

**Minimal fix before integration:** owner-scoped AbortController plus an in-flight promise set; every request path must reject once closed; stop admission, settle/abort work in a defined order, then DELETE any session learned during the race. Add close-during-initialize (headers before and after close), close-during-tool-body, and abort-vs-result race tests. Server-side idle expiry remains necessary when abort happens before a client can learn the session ID.

### 3. High correctness/resource fan-out risk — confirmed API permits unsafe replay

**Path:** `src/tasks/t3-mcp-client.ts (`callTool` reconnect branch)`.

On HTTP 400/404, `callTool` transparently initializes a new MCP session and repeats the tool call. The comment assumes delegate calls carry `clientRequestId`, but the generic API does not enforce that. A future caller can invoke non-idempotent `delegate_task` without a stable key; if the first call committed and only its response/session failed, replay can create a second child. The experimental bridge documentation explicitly required a stable key.

**Minimal fix:** make delegation a typed method requiring a non-empty bounded `clientRequestId`, and only auto-replay operations whose idempotency contract is established. Allocate/retain one key per logical launch before I/O and reuse it for ambiguous retries. Test “commit then 404/drop” => exactly one child.

### 4. High security — confirmed: generic bearer client has no tool allowlist

`T3McpClient.callTool(name, ...)` accepts any name. Upstream credential issuance grants `orchestration`, `worktree`, and `pull-requests` by default (`McpSessionRegistry.ts:130-140`). Arbitrary execute code already inherits the bearer environment, so UI/tool registration is not an authorization boundary. A production bridge intended only for delegation cannot rely on “call these three names” guidance.

**Minimal fix/test:** bridge-specific orchestration-only audience/capability enforced server-side, plus a client allowlist for defense in depth. Also restrict plain `http:` endpoints to loopback/Unix-local transport. The current URL validator accepts cleartext HTTP to any host and would transmit the bearer over the network. Require HTTPS otherwise. Verify worktree/PR/preview and cross-thread/provider IDs reject. Ensure errors never print bearer or response payload.

### Rejected implementation guardrails (not present in latest source)

The removed `T3TaskBackend` snapshot demonstrated three designs that cannot return:

- terminal `RemoteRecord` entries were never deleted and retained `lastOutput` O(N);
- every polling error was swallowed and rescheduled at 1 Hz forever;
- extension shutdown closed/cleared the MCP backend before TaskManager attempted remote cancellation, forcing watchdog expiry and leaving the T3 child alive.

Regression tests should still assert zero remote records/timers after N completions, bounded classified retry/backoff, and cancel/settle-before-DELETE ordering.

### 5. Medium-high — confirmed upstream overload risks that migration must not import unbounded

These are reachable queue shapes in the reviewed upstream v2 tree, not generic claims:

- `Adapters/PiRpc.ts:266-309` uses unbounded `events` and `outgoing` queues. A provider emitting events faster than its adapter consumer, or many sends behind a stalled stdin, grows resident memory. Individual JSONL framing is capped at 8 MiB (lines 110-138), but queue aggregate is not.
- `terminal/Manager.ts:454-468,2005-2050,2277-2289` appends every PTY output callback to `pendingProcessEvents` while a single drain serially sanitizes, persists, and publishes. History is bounded (5,000 lines/8 MiB) and inactive sessions are capped at 128, but the producer backlog itself is unbounded. A noisy PTY plus a slow listener/disk is the reachable case.
- `ProviderContinuationRequests.ts:66-75` is an unbounded queue drained serially by `ProviderContinuationService.ts:173-211`. Dispatch failures fork one sleeping retry fiber per request (lines 183-204) and re-offer. A DB/provider outage during many child completions can accumulate requests, retry-map entries, and fibers even though completion ownership is durable.
- `ProviderSessionManager.ts:1215` creates unbounded per-subscriber provider-event queues; slow/stalled subscribers can retain events until release. Session release does clear/fail subscriber maps, but that does not bound a live slow consumer.

**Minimal migration rule:** do not route these streams into Die without byte/item budgets and an explicit overflow policy (coalesce state updates, backpressure producer, disconnect/replay from durable cursor, or truncate with a marker). Never silently drop terminal/result/ACK transitions. Preserve upstream’s positive bounded patterns: `EffectOutbox.ts:269-280` uses a dropping 64-item wake hint while SQL rows remain authoritative; `ThreadLiveEventCoalescer.ts` has a 512-update window plus byte budget and finalizer cleanup.

### 6. High on timeout path — confirmed ownership release before provider scope actually closes

**Path:** upstream `ProviderSessionManager.ts:699-837`. `releaseEntry` removes the live session from the resident map first (lines 714-723), then closes its scope in a detached fiber. After 30 seconds it logs and detaches another join (742-783), writes “released” events, and proceeds to credential cleanup whose comment assumes “the provider process is gone” (803-831). The source itself names a provider stream/finalizer that never yields as the reachable wedge. PiRpc has a strong early process-group finalizer, but sequential scope finalization can prevent reaching it. No independent process-group kill is shown on this timeout branch.

**Impact:** a timed-out release is no longer discoverable through the sessions map, may still own a provider process/stdio/fibers, and may have its credential revoked while that process remains alive. This is a bounded wait, not bounded cleanup. Actual orphaning is **source-confirmed as possible, runtime-unproven** until a wedged-finalizer process test is run.

**Minimal fix/test:** on scope-close timeout invoke an identity-checked emergency provider process-group kill outside the wedged scope, close stdio, and retain a small tombstone until exit/reap is observed. In a deterministic adapter fixture, wedge an earlier finalizer, launch a real descendant, release/shutdown, and assert the PID/group, FDs, subscriber queues, detached fibers, and credential are gone within a second hard bound. Do not report “released”/revoke on the assumption that process ownership ended.

### 7. Medium — confirmed scope/secret lifetime concern; least privilege is not demonstrated

Upstream `McpSessionRegistry.ts:123-159` stores token hashes, which is good, and scopes credentials to environment/thread/provider instance. Raw authorization is retained in `McpProviderSession.sessionsByThread` (`McpProviderSession.ts:44-59`) and in the Die `T3McpClient` for the client lifetime. Normal ProviderSessionManager paths clear/revoke credentials (around lines 450-488 and release paths), with 24-hour lazy pruning for abandoned hashes.

But registry issuance always grants `orchestration`, `worktree`, and `pull-requests` (`McpSessionRegistry.ts:130-140`). Any arbitrary execute code inheriting the bearer can call every tool allowed by that credential, not just `delegate_task/task_status/task_cancel`. Model guidance and registering only three wrappers are not an authorization boundary.

**Minimal fix/test:** mint a bridge-specific orchestration-only capability/token, or enforce an allowlist server-side for this client audience. Verify cross-thread IDs, wrong provider instance, worktree/PR/preview tools, expired/revoked tokens, and post-session DELETE all reject. Never log URL query credentials, Authorization, raw environment, response payload, or provider stderr; current client errors include status only, which is appropriate.

## Important non-findings / boundaries

- **Response/transport bound is present in the current patch.** `src/tasks/t3-mcp-client.ts` (`MAX_RESPONSE_BYTES` and `boundedBody`) caps the complete HTTP/SSE body at 1,000,000 bytes and cancels the reader in `finally`; non-2xx and notification/DELETE bodies are cancelled. Retain this. Test exact-limit, one-byte-over, endless stream + abort, invalid SSE, non-2xx with endless body, and DELETE timeout. A `Content-Length` fast reject is optional; streamed counting remains authoritative.
- T3 production projections are SQL-backed (`ProjectionStore.ts:1441...`). The all-thread `replayState.projections` map is `layerMemory` at line 4539, not the production layer. Do not call durable event/task graph rows a heap leak. MCP status temporarily loads parent/child projections, but no production all-thread projection cache was found here.
- Terminal results and original thread history remaining in the DB/event journal are intentional durability, not leaks. ACK changes delivery state. It need not delete result history. The resource requirement is bounded transient/resident delivery state and an explicit disk retention policy.
- MCP registry’s 24-hour stale-hash window is a bounded security/lifetime policy, not an unbounded secret leak: raw tokens are not stored there and normal release revokes eagerly. Still test a burst of N issued/revoked sessions and lazy prune after time advance.
- RSS fluctuations alone are not evidence. Use heap/object counts, map/queue counters, active handles, FDs, sockets, timers, and descendant process identity.

## Existing Die protections that must survive migration

1. **Job output:** `BoundedOutputBuffer` caps each live task; TaskManager caps inspect pages and aggregate completed output, and drops process/completion promises on settle. Remote tasks must enter exactly this same accounting and cannot duplicate payloads in another permanent map.
2. **Execute output:** `src/typescript/output-capture.ts` has a 10 MiB total byte cap, bounded inline preview, spill files with restrictive modes, and handle close paths. Do not pipe an unbounded T3 result around it.
3. **Job bridge:** `src/typescript/job-bridge.ts` caps frames at 1 MiB, deletes pending RPC entries, removes abort/ACK listeners, and aborts served requests on disconnect. Preserve the ACK ownership rule: loss before worker ACK returns notification ownership. No result loss.
4. **Local process ownership:** TaskManager launches detached POSIX groups, sends group SIGTERM then SIGKILL, keeps escalation after shell exit, bounds shutdown, destroys stdio, and clears listeners. Remote ownership needs an equivalent T3 cancellation/settlement contract rather than pretending local signals apply.
5. **Web launcher:** `src/web/launcher.ts` removes SIGINT/SIGTERM listeners and escalates an owned backend process group. Do not add per-session global signal listeners.
6. **History:** disk-backed entry storage and temporary pending-file cleanup from v0.4.0 must remain. Persistent history/artifacts are policy-governed storage, not to be silently expired as a leak fix.

## Deterministic release tests and probes

The current `tests/t3-production-bridge.test.ts` covers configuration fail-closed behavior, a finite oversize response, one abort, one expired-session reconnect, and 20 initialize/DELETE cycles. Those are useful functional checks, but the 20-cycle assertion only counts server DELETE requests. It does not prove post-idle socket/handle/heap release, close-vs-initialize safety, task lifecycle cleanup, or process-tree cleanup.

Use isolated HOME/TMPDIR/database/ports and fixture transports. No shared server. Choose N large enough to expose slope (suggest 1,000 sequential, 100 concurrent; repeat after warm-up). Expose test-only counters rather than introspecting private fields.

### A. Sequential launch/finish/ACK/post-idle

For each of N tasks: delegate asynchronously, emit bounded progress, finish with near-limit result, poll/status until terminal, inspect, and let ACK complete. After a forced GC and two idle polling intervals assert:

- backend remote-record count = 0; poll timers/in-flight requests = 0;
- MCP server sessions/transports = baseline (or exactly one intentionally session-scoped connection before shutdown, zero after);
- TaskManager completed-output bytes <= configured aggregate budget; task metadata count follows documented policy;
- listener/subscriber/queue/fiber counts return to baseline;
- heap retained bytes for bridge/backend/result objects plateau between N/2 and N (heap snapshots/object counts, not RSS);
- DB has exactly N durable tasks/results and terminal delivery state. No result was deleted just to flatten RAM.

### B. Launch/cancel and nested cancellation

Repeat N launch → progress → cancel at these barriers: before delegate response, after durable creation before response, while polling, during result response, and during MCP close. Include parent → child → grandchild. Assert idempotent repeated cancel, all provider process groups/PTY helpers are gone within the bound, no open stdin/stdout/stderr/HTTP sockets remain, no completion retry fiber remains, and durable child IDs/results/cancel state are queryable. Upstream has run-owned subagent terminalization logic, but I did not find evidence here that cancelling an app-owned child recursively stops all nested app-owned descendants; treat that as **unproven** until the process/tree test passes.

### C. Fault/backpressure matrix

- Commit delegate then drop response; retry same logical launch: exactly one child.
- Stall response body at 0 bytes, exactly 1 MB, and 1 MB + 1; abort each phase. Assert reader/body/socket release and bounded latency.
- Permanent 401/403/404, invalid JSON/SSE, response-ID mismatch, and endless SSE: no infinite 1 Hz polling; bounded terminal/degraded state and no secret in errors.
- Block provider-event consumer, continuation dispatch, Pi stdin, terminal listener, and artifact writer while producing fixed-size events. Assert configured queue byte/item ceilings and explicit overflow semantics; terminal result/ACK must survive via durable replay.
- Kill parent/server at every launch/cancel/ACK boundary; restart and recover from DB without duplicate child, lost result, or orphan process.

### D. Resource instrumentation

Record before/warm/mid/end/post-idle: heap snapshots or retained-object counts by `RemoteRecord`, result strings, queues and fibers; test counters for maps/listeners/timers/in-flight fetches/MCP sessions; `/proc/<pid>/fd`, socket states, thread count, and identity-checked descendant process groups. Track DB row/disk growth separately as expected durable history. RSS may be reported only as supporting context, never as the leak verdict.

## Baseline regression evidence to retain from v0.4.0

From `wisdom/resources/memory-resource-audit.md` and the release note:

- 2,000 CLI session replacements: 9 FDs, 16 threads, zero children.
- 2,000 mixed CLI turns: 11–12 FDs, 17 threads, zero children (RSS drift explicitly inconclusive).
- Execute lifecycle stress: 8 FDs, 6/6 pending bridge handlers aborted, 0/10 descendants survived, final-120 RSS delta only supporting context.
- 1,010 web-launcher exits: no retained FDs or SIGINT/SIGTERM listeners.
- 3,000 current-web reconnects under Node GC instrumentation; 600 bundled-Bun reconnects plus 64 held subscriptions; all held FDs released and no descendants.
- The prior focused gates: 68 history/UI/bounds, 83 execute/bridge/launcher, 728 current-web tests/probes, plus TypeScript check. Durable probes to keep include `scripts/leak-audit/execution-runtime.ts`, `bridge-retention.ts`, `web-launcher-runtime.ts`, `current-web-client-tests.mjs`, `current-web-server-runtime.mjs`, `bundled-web-runtime.mjs`, `cli-rpc-soak.ts`, and `session-journal.ts`.

These baselines do not cover T3 remote delegation. Final production acceptance must add the N-cycle remote tests above and show bounded resident objects/queues plus zero owned descendants/sockets after cancellation and shutdown.
