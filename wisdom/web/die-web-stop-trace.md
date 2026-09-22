# die web Stop/cancel trace (read-only diagnosis)

## Bottom line

The browser Stop command is wired correctly for an **active Pi turn**, but Pi's adapter has a cancellation-latency hole: it awaits the RPC `abort` response under the transport's generic **120 s** request timeout. The real Pi/die RPC implementation does not answer `abort` until `AgentSession.abort()` has made the session idle. A held model request or non-cooperative/slow tool therefore leaves T3 projected as running and makes Stop look inert for up to two minutes. Other modern adapters explicitly bound cancellation (OpenCode uses 10 s) and then fail/tear down.

The smallest current-turn fix is in `PiAdapter.interruptTurn`: bound `ctx.client.abort()` to a short cancellation timeout (consistent with OpenCode's 10 s), map timeout to `ProviderAdapterRequestError`, and let the existing `ProviderCommandReactor` failure path call `stopSession` and clear `activeTurnId`. Do not build a task-control service for this.

Detached die jobs are a separate semantic boundary. They intentionally survive abortion of the tool call/turn. Current Pi code partially claims otherwise and tracks the wrong background maps; Stop cannot cancel an already-detached TaskManager child with today's one-way sparse lifecycle records.

## End-to-end path

1. UI button: `apps/web/src/components/chat/ComposerPrimaryActions.tsx` calls `onInterrupt`. `apps/web/src/components/ChatView.tsx:3770-3789` builds input and dispatches `threadEnvironment.interruptTurn`.
2. UI eligibility/input: `apps/web/src/components/ChatView.logic.ts:652-660` requires UI phase and projected session status both `running`. It includes projected `activeTurnId` when available and intentionally sends only `threadId` during the pending-start window. Tests: `ChatView.logic.test.ts:1545-1577`.
3. Client command: `packages/client-runtime/src/state/threadCommands.ts:207` -> `packages/client-runtime/src/operations/commands.ts:318` -> contract `packages/contracts/src/orchestration.ts:1255-1262`.
4. Decider emits `thread.turn-interrupt-requested`: `apps/server/src/orchestration/decider.ts:1392-1411`.
5. Reactor: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:1579-1675`. It deliberately drops the orchestration turn id at the provider boundary (line 1672 comment), because orchestration and provider turn ids are different, and invokes `providerService.interruptTurn({threadId})`. On failure it calls `stopSession` and, unless a natural completion won the race, projects `status: stopped, activeTurnId: null` plus failure activity.
6. Service routing: `apps/server/src/provider/Layers/ProviderService.ts:1919-1953` resolves the bound adapter and calls `adapter.interruptTurn(routed.threadId, input.turnId)`. The adapter contract is `apps/server/src/provider/Services/ProviderAdapter.ts:91-95`. `ProviderDriver` itself is only instance construction/SPI; cancellation belongs to the adapter, not the driver (`apps/server/src/provider/ProviderDriver.ts:121-171`).
7. Pi: `apps/server/src/provider/Layers/PiAdapter.ts:2259-2280` marks the active turn `interruptRequested` and awaits `ctx.client.abort()`. Native `message_end(stopReason=aborted)` marks interruption (1656-1658); `agent_settled` checks `get_state` and publishes terminal `turn.completed {state: interrupted}` (1729-1800). `publishTerminal` clears adapter `activeTurn` and session `activeTurnId` (623-646). Runtime ingestion then clears the orchestration projection.
8. RPC transport: `apps/server/src/provider/pi/PiRpcClient.ts:275-314, 336-348` sends a concurrent id-tagged `abort` request. Writer serialization does not block abort behind prompt; prompt response is emitted after preflight, not generation completion. The generic timeout is 120,000 ms at lines 110-116.
9. Real installed backend: `.../@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js:298-331` starts prompt asynchronously but handles abort as `await session.abort(); return success`. `dist/core/agent-session.js:1220-1228` calls retry/compaction/branch aborts, `agent.abort()`, then **awaits `waitForIdle()`**. Thus a held request/tool directly holds the RPC response.

## Concrete issues

### P0/P1: Pi abort has an unsuitable 120-second failure bound

- `PiAdapter.interruptTurn` has no adapter-level timeout or acknowledgement/completion race.
- `PiRpcClient`'s 120 s generic timeout is reasonable for some RPCs but not an interactive Stop SLA.
- Until either native terminal events arrive or the request fails and reactor fallback closes the session, the UI remains running. This exactly presents as “Stop does not work.”
- Modern comparison: `OpenCodeAdapter.ts:3499-3580` keeps explicit cancellation state/deferred acknowledgement/completion and bounds parent and descendant abort calls to 10 s. Pi need not copy all of that machinery; a bounded abort plus existing close fallback is the small fix.

**Smallest fix:** wrap only `ctx.client.abort()` in `PiAdapter.interruptTurn` with a 10 s timeout and convert `TimeoutError` to a request error whose detail says Pi abort did not settle. Do the same for the post-steer abort at lines 2129-2132 via one local helper, so both paths have identical bounds. The reactor already owns fallback teardown/projection cleanup.

A slightly stronger but still small alternative is a Pi-specific short timeout parameter on `PiRpcClient.abort`; avoid reducing the global 120 s timeout for discovery/prompt/state RPCs.

### P1/P2: “background work” detection does not include actual die task records

- Pi receives installed die lifecycle records into `ctx.dieTasksById` in `handleDieTaskEvent` (`PiAdapter.ts:1450-1530`).
- `interruptTurn` computes `hasBackgroundTasks` only from `agentTasksById`, `workflowTasks`, and `extensionSubagentTasks` (2266-2269), omitting running `dieTasksById`. Existing “interrupt after parent settled” coverage (PiAdapter.test.ts:1502-1545) exercises native `subagent_spawn`, not `die_task_event`.
- Merely adding `dieTasksById` to that boolean does **not** make cancellation work. Once parent agent is idle, real RPC `session.abort()` has no handle to the detached TaskManager process and returns immediately.

Treat this as an accuracy/test gap, not justification for broad task control. Either (a) define Stop as active-turn-only and remove/comment-correct the background-only promise, or (b) later add a narrowly scoped job-kill RPC. Option (a) is the smallest scope now.

### Expected/non-bugs

- Dropping the browser/orchestration `turnId` in the reactor is correct. Passing it to Pi would cause “No matching active Pi turn” because Pi allocates a separate provider turn id.
- Pending-start interruption is intentionally session-targeted. UI permits `running + activeTurnId:null`; on Pi pre-begin failure, reactor fallback closes the session. Pi's test `interrupts and stops while prompt preflight is blocked` (PiAdapter.test.ts:727-751) covers the post-`beginTurn` blocked-prompt case.
- Long synchronous `execute` is cancellation-aware: installed die `src/typescript/extension.ts:75-114` passes the Pi tool AbortSignal into `executeIsolated`; `src/typescript/execution.ts:108-132` aborts its bridge and SIGTERMs/SIGKILLs the process group. It can delay idle until process close/escalation, but should be bounded around the execute kill grace.
- Detached `shell()/subagent()` jobs are intentionally different. `TaskManager.foreground` (`src/tasks/task-manager.ts:319-384`) releases a foreground waiter when its signal aborts and transfers notification ownership; it does not kill the managed task. Actual kill is `TaskManager.kill` (409-428), and all tasks are killed only on `session_shutdown` via `TaskManager.shutdown` (431-480) registered in `src/tasks/extension.ts:564-578`. RPC turn abort does not emit session shutdown.
- Core `src/tasks/web-events.ts` remains deliberately sparse: only `started/completed` one-way records, no stopping event and no control request. Do not overload it into a task-control protocol for this fix.

## Test gaps / targeted additions

1. **PiAdapter timeout/fallback contract:** fake `client.abort()` never resolves; with TestClock, assert `interruptTurn` fails at the short bound. At reactor level assert this failure invokes `stopSession` and ends projected session with `activeTurnId:null`.
2. **Held long execute:** adapter/RPC fixture where abort response waits for simulated tool idle; release after abort signal and assert terminal interrupted event plus active turn clearing. No live model needed.
3. **Transport waiter cleanup:** timeout an abort, then send its late response and a second command response; verify late response is ignored and the client remains usable (request's `ensuring(remove(id))` should support this).
4. **Die detached-task semantic test:** inject `die_task_event started`, settle parent, call interrupt. Document expected active-turn-only behavior (failure/no fake stop) until an actual kill channel exists. Current native subagent test is not equivalent.
5. **UI integration gap:** existing tests validate button rendering and input construction, but no test spans click -> environment command -> server interrupt -> terminal projection. Browser smoke owner should assert Stop leaves running state within the chosen bound, not merely that the button dispatches.

## Local verification

Ran targeted existing tests without source edits:

`./node_modules/.bin/vp test run apps/server/src/provider/Layers/PiAdapter.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts apps/web/src/components/ChatView.logic.test.ts`

Result: PiAdapter + ChatView logic passed as part of 205 passing tests; ProviderCommandReactor suite failed during import with host `ENOSPC: no space left on device` (not an assertion failure). No live model calls, installs, or commits.
