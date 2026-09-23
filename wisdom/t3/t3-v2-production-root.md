# T3 v2 production root delegation integration

**Owner:** root delegation worker. **Status:** safe transport/fail-closed stage complete; production delegation adoption blocked on backend contract.

## Inventory read

Read the production inventory, independent requirements/resource warning, experiment acceptance/code review, current task/execute lifecycle and resource audits, product guidance, prototype client, and the pinned candidate's actual orchestration MCP schemas/tool descriptions. Prototype code is evidence only and is not imported at runtime.

## Implemented safe stage

- Added a production-owned bounded Streamable HTTP MCP client in `src/tasks/t3-mcp-client.ts`: all-or-nothing scoped environment parsing, credential-free errors, HTTP(S)-only endpoint validation, bearer and MCP protocol/session headers, initialized notification, matching JSON-RPC IDs, bounded JSON/SSE reads, redirect rejection, caller abort plus request deadlines, one expired-session reconnect, and bounded DELETE cleanup.
- Existing local CLI behavior is unchanged when neither T3 variable is present.
- A partial or authorized T3 context now fails closed at the existing `subagent()` routing surface instead of spawning a local child. Shell jobs and every non-delegation job affordance remain on the existing TaskManager.
- Added focused tests for auth/context refusal, protocol/session/SSE behavior, reconnect/result retry, abort, repeated session cleanup, and no local spawn under scoped context.

## Backend interface required before routing can be enabled

The candidate's actual `OrchestratorMcpDelegateTaskInput` accepts only `task`, `target`, `title`, semantic `role` (implementation/research/review/design/test/general), `mode`, wait-only `timeoutMs`, `clientRequestId`, `runtimeMode`, and `interactionMode`. `target` accepts provider instance/driver, model, and advertised model options. It does **not** accept Die profile, thinking, cwd, depth, or parent task IDs. Result metadata includes task/child thread/run/node IDs, work state, pending descendants, terminal run/status/summary/transfer ID, provider/model, summary/result transfer ID, and wait timeout.

The web/backend owner must publish and enforce this scoped contract before root adoption:

1. An authoritative server-side Die profile/depth claim and exact fast/normal/orchestrator to provider/model/options/runtime/interaction/role-prompt mapping. Client-only labels are not policy.
2. One completion owner. T3 documents automatic parent delivery; `task_status` on a terminal task acknowledges that delivery. Root cannot poll status or emit a second Die wake. Provide a durable, reconnectable telemetry event (or an explicit decision that T3 delivery alone owns wake) that can settle the Die job projection without prematurely ACKing model delivery.
3. Durable launch replay identity across an ambiguous HTTP response. A random key held only by one call is insufficient; define backend replay retention and how Die recovers the same key/task after restart.
4. Stable metadata needed in the job projection: task, child thread/run/node, terminal transfer, profile/depth, and transcript navigation identity. T3 is still the sole transcript writer. No Die child session file may be created.
5. Cancellation and teardown policy: selected `task_cancel`, parent Stop, provider-session shutdown, and process teardown are distinct. MCP DELETE only closes this client session and cannot be treated as child cancellation. Define nested closure and revocation behavior.
6. Explicit support/rejection for jobs input/closeInput (expected rejection), watch/snooze/attention, inspect/status ACK semantics, handoff, cost/history/compaction/memory, and Herdr activity.

## Why broad adoption was removed

An initial permissive adapter was tested, then removed after the independent requirements warning and exact pinned schemas became available. It invented unsupported request fields/roles, erased native result identity, used volatile replay keys, polled and swallowed failures, risked acknowledging T3 delivery before it reached the parent, and could orphan children on shutdown. Shipping that would violate the requested no-double-persistence/exactly-once guarantees. The current fail-closed stage is narrow rather than claiming unvalidated production delegation.

## Evidence

Typecheck and the focused transport plus unchanged job/task suites pass: 38 tests, 238 assertions, 0 failures. No web patch/candidate files, release/install/version/process state, or experiment runtime dependencies were changed by this worker.

## 2026-09-21 05:27Z — native ROOT contract adopted

Root will consume only the backend-owned scoped MCP tools below (no legacy schema translation):

- `die_task_launch({ clientRequestId, prompt, profile, timeoutMs? })`
- `die_task_observe({ taskId })` (read-only; MUST NOT acknowledge model delivery)
- `die_task_cancel({ taskId })`
- `die_task_list({})`

Task result is the strict version-1 shape: `{ version:1, taskId, childThreadId, childRunId?, childNodeId?, status, profile, depth, output?, transferId? }`; list is `{ tasks: TaskResult[] }`. Scoped launch is async-only: explicit `waitSeconds` is rejected, the execute projection is always background-owned, and root never emits a second completion. T3 alone owns terminal delivery. Observe/list are projections only and may not ACK. Root stores only a bounded durable pre-I/O launch replay key (no child transcript/session/output registry), reuses it across an unacknowledged bridge response, and removes it after the existing execute response ACK. Local shell jobs remain on TaskManager; native inspect/list/stop call backend truthfully; input/closeInput/watch/snooze reject for native IDs. Backend bearer scope and profile/depth enforcement remain server-owned; root adds no authorization env claims.

### Contract refinement disposition — cancel input

Backend note proposed adding `clientRequestId` to cancel. ROOT does **not** adopt that refinement because the coordinator-fixed shared contract is exact: `die_task_cancel({ taskId })`. The hardened MCP client may replay once only on expired-session HTTP 404; ROOT does not generically replay cancel after ambiguous transport failure. Backend cancellation itself must remain idempotent by `taskId` and return the truthful task projection. If mutation replay identity becomes mandatory, it needs an explicit coordinator contract revision and matching fixture update before either side changes wire shape.

### ROOT implementation evidence

Implemented strict typed adapter, exact JSON fixture, scoped JobService routing, fsync+rename bounded launch identity ledger, and execute response-ACK release. Focused verification: 38 tests / 467 assertions pass across job service, bridge protocol, hardened MCP transport, and native routing; TypeScript and diff checks pass. A wider 85-test run had 84 pass and one unrelated compiled lifecycle test fail because `/tmp` was full (ENOSPC). No functional assertion failed. Integration is still blocked until backend uses the coordinator-fixed cancel input (no added clientRequestId) and its candidate is available for cross-tree live tests.


## 2026-09-21 05:48Z — coordinator review fixes completed

- Scoped native subagent accepts omitted `waitSeconds` and explicit `0`; positive values fail with native async-only guidance.
- Execute tool-call ID now crosses the isolated job bridge, and each request carries its bridge call ordinal through cancellation wrappers. Native launch replay identity is execute invocation + call ordinal + batch index only—never prompt/profile equality. The ledger commit still precedes backend I/O.
- Added concurrent identical-call/replay coverage: same prompt in two concurrent calls produces two request IDs; replay of the same execute invocation recovers each corresponding ID and distinct child.
- Scoped routing bypasses local DIE_SUBAGENT depth/type policy. Strict returned profile/depth schema validation remains (depth 0..2), while backend values are authoritative and are not compared to local env or requested profile. Local CLI policy is unchanged.
- Cancel remains exactly `die_task_cancel({ taskId })`.
- Ledger writes now unlink temporary files for open/write/sync/rename failure paths, bound file/entry/field sizes and duplicates, and use length-prefixed hashing with no literal NUL source byte.
- Execute guidance documents native async and unsupported stream/watch controls.
- Verification used `TMPDIR=/var/tmp`: `bun run check` passed; focused bridge/routing/execute suites passed 92 tests / 701 assertions. Full suite passed 699 tests / 4,536 assertions with 14 expected live/TUI skips and 0 failures.

### Coordinator ACK crash-window correction (05:51Z)
The pending launch ledger originally allocated a fresh random key after sandbox ACK cleanup. That would duplicate a child if the outer execute tool result had not yet committed and the same execute invocation replayed after a crash. Keys now derive deterministically from durable execute invocation/call ordinal/batch identity; ACK retires pending bookkeeping only, never changes native intent identity. A regression asserts same intent after ACK/reload keeps the key, while a distinct intent differs. Native ACK cleanup disk errors are caught and diagnosed rather than unhandled. Focused native routing: 7 pass, 41 assertions.

### Coordinator bounded telemetry integration (06:05Z)
Backend contract now paginates die_task_list({cursor?:string,count?:1..100}) -> {tasks,total,nextCursor?} and optionally marks outputTruncated on observed summaries. Root adapter/fixture/jobs.list now use this exact paged contract without collecting all native results. Native inspect uses the existing UTF-8-safe byte paging helper and exposes continuation offsets, loss/truncation navigation metadata. These are metadata projections only; observe still never ACKs. Actual candidate/root schema conformance rerun in progress.

Further recovery/resource correction: bounded pending ledger now drops oldest bookkeeping at256 rather than permanently refusing launches after failed/unacknowledged attempts. This is safe only because intent keys are deterministic across eviction/ACK/restart. Test reserves261 intents, asserts256 retained, and recovers the evicted intent's original key. Native routing8 tests/44 assertions pass.
Actual cross-tree conformance PASS for all4 backend Effect schemas vs root Zod fixture after bounded pagination integration; focused routing/bridge/job suites30 pass before the additional eviction test.
