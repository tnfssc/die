# Pinned T3 backend execution/control model and independent Die child threads

## Scope and source of truth

`web/t3-source.json` pins `https://github.com/pingdotgg/t3code.git` at `719a76ca1dbf5490f1aa33ffb9966301e02be9a9`; `web/t3.patch` is the canonical integration patch.

There are two generated trees. `.cache/die-t3code` is stale: its shallow HEAD is `6f00d388...` and it does not contain the pin. `.cache/die-t3code-v0042` has exactly `719a76ca...`, and `git apply --reverse --check /home/tnfssc/Code/die/web/t3.patch` succeeds there. All T3 citations below are to `.cache/die-t3code-v0042`, the tree proven to equal the JSON pin plus patch. I inspected source and tests and ran that reverse-patch check; I did not modify product code or run the test suite.

## Executive finding

Pinned T3 already has genuine backend-owned executable threads. A websocket command is durably decided into events, projected to SQL, reacted to by a provider reactor, and bound by thread ID to a provider session/process. Shell and detail websocket streams are reconnectable views of that backend state.

The current Die patch uses that model only for the outer Die conversation. Each outer T3 thread owns one Pi adapter session launching one `die --mode rpc --session ...` process. When that Die process calls `subagent`, Die itself creates a separate session file and child process. T3 receives only bounded `die_task_event` lifecycle notices and projects them as task activities on the **parent T3 thread**. There is no child T3 `thread.create`, provider binding, detail subscription, or per-child T3 control.

Two real alternatives follow:

1. **Read-only child projection:** Die remains execution owner; T3 registers/mirrors child threads and proxies control to the owning parent Die. T3 must be forbidden from starting/resuming the child's live session file.
2. **Backend-owned child execution:** web-mode delegation asks T3 to create/start a normal child thread; Die must not also spawn that child locally. This best matches the goal of independently executable/viewable/controllable threads.

Starting a T3 Pi session on a session file while an independently spawned Die child is still writing it is unsafe. The added Pi lease is in-memory inside one adapter process and cannot see an external child writer.

---

## 1. Actual T3 thread command-to-process path

### Contracts and browser send

The orchestration surface has `thread.create` with project/model/modes/worktree and optional `historyImport` (`packages/contracts/src/orchestration.ts:1047-1062`); `thread.turn.start` with user message, modes and optional atomic bootstrap (`:1212-1258`); `thread.turn.interrupt` (`:1280-1286`); and `thread.session.stop` (`:1333-1344`). These are in client/dispatchable unions (`:1346-1409`). Corresponding intent payloads include turn-start, interrupt, session-stop, and session-set (`:1800-1867`).

A projected thread includes messages, activities, checkpoints, latest turn, and nullable session (`:728-787`). Session statuses include starting/running/ready/interrupted/stopped/error (`:543-564`). The pinned schema has no parent-thread, child-thread, task, or execution-owner field.

The web composer builds one `thread.turn.start`; for drafts, `bootstrap.createThread` atomically creates and sends (`apps/web/src/components/ChatView.tsx:7913-7993`). “Started in background” promotes a normal T3 draft thread and opens another composer (`:7994-8055`); it is unrelated to Die subagent spawning.

Client runtime assigns command ID/timestamp and calls `orchestration.dispatchCommand` (`packages/client-runtime/src/operations/commands.ts:68-93,300-321`). RPC schema validation is at `packages/contracts/src/rpc.ts:1241-1245`; method names are at `packages/contracts/src/orchestration.ts:35-44`.

### Engine, projection, and reactor

The websocket handler normalizes and dispatches (`apps/server/src/ws.ts:1819-1855`). The engine runs one queue/worker (`apps/server/src/orchestration/Layers/OrchestrationEngine.ts:413-447`). It checks command receipts for idempotence/cross-aggregate conflict (`:144-171`), invokes the decider (`:245-263`), transactionally appends events, updates read model/projections, and records acceptance (`:273-320`), then publishes committed events (`:322-341,455-466`).

Projection bootstrap replays from projector checkpoints (`apps/server/src/orchestration/Layers/ProjectionPipeline.ts:2107-2169`). The orchestration reactor starts provider ingestion, provider-command, checkpoint, deletion, settlement, PR, and awareness reactors (`apps/server/src/orchestration/Layers/OrchestrationReactor.ts:17-40`). A projection makes a thread visible; the provider command reactor makes it executable.

The provider reactor subscribes before startup returns (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:1851-1885`). A turn-start resolves the persisted message, ensures a session, builds a provider request, and forks `providerService.sendTurn` (`:1470-1499`). Interrupt/stop/settlement are distinct handlers (`:1760-1825`). `ensureSessionForThread` finds the live adapter session by the same T3 thread ID (`:554-578`), checks continuation compatibility (`:665-685`), starts via `providerService.startSession(threadId, ...)` and writes `thread.session.set` (`:698-742`), or reuses/restarts with resume cursor (`:744-814`).

**Result:** an executable T3 thread is event state plus a provider binding/session and reactor, not a shell/status card.

---

## 2. Websocket reconnect model

The shell stream subscribes live before loading state, buffers/coalesces, and either replays after `afterSequence` or falls back to a snapshot for invalid/large gaps (`apps/server/src/ws.ts:1955-2107`). Thread detail does the same with bounded per-thread replay and snapshot fallback (`:2128-2285`, especially `:2145-2170,2175-2237`). Synchronization markers close snapshot/live races.

Thus browser disconnect does not stop or own execution. The backend/provider process continues; reconnect reconstructs projected state and resumes live events. A real backend child inherits this automatically. A card-only child does not.

---

## 3. Session ownership, resume/import, leases

### Durable provider routing

`ProviderSessionDirectory` persists thread-keyed provider, instance, adapter key, mode/status, resume cursor, and runtime payload (`apps/server/src/provider/Layers/ProviderSessionDirectory.ts:119-153,181-206`). Routing requires that binding. ProviderService adopts an existing adapter session or, when recovery is allowed, resumes from persisted cursor/cwd/model (`apps/server/src/provider/Layers/ProviderService.ts:1180-1360`). Start reuses compatible persisted cursor/cwd (`:1437-1485`), starts the adapter, stops stale same-thread sessions elsewhere, and updates the binding (`:1501-1536`). Stop snapshots the session and marks the binding stopped rather than deleting continuation identity (`:2032-2085`). Tests cover recovery, preserved bindings, stale-session replacement, persisted cwd, and cursor reuse (`ProviderService.test.ts:2617,2661,2773,2812,2853,3037`).

### Imported sessions

Import currently supports only Claude Agent and Codex (`packages/contracts/src/agentSessions.ts:6-7`; `apps/server/src/project/AgentSessionScanner.ts:1093`). It creates deterministic imported threads, installs a **stopped** binding/cursor before visibility, then dispatches `thread.create(historyImport: true)` and history (`apps/server/src/project/AgentSessionImporter.ts:166-274`). It refuses modified or non-stopped bindings (`:206-240`).

Tests prove import is dormant: no session/turn and no start/send until the first later prompt; that prompt resumes once with cursor/cwd (`AgentSessionImporter.test.ts:937-996`). A race test proves import cannot overwrite a concurrent running binding (`:1147-1205`). This proves safe post-ownership-transfer continuation, not live Pi/Die mirroring.

### Pi session-file lease

The patched Pi adapter owns `sessions: Map<ThreadId,...>`, `sessionFileLeases: Map<path,...>`, and per-thread semaphores (`apps/server/src/provider/Layers/PiAdapter.ts:396-438,455-474`). Start allocates/validates the file, rejects an existing lease, acquires before spawn, launches with `--session <file> --offline`, validates exact path/id, then publishes the context (`:1939-2161`). Close removes context/lease (`:773-780`). Tests prove interrupted startup releases ownership and one durable file cannot back two live adapter threads (`PiAdapter.test.ts:3512-3584`).

But the lease is a JS map in one adapter object—not an OS/database lease. It cannot detect `TaskManager.spawn` in another Die process. It does not make live adoption safe.

### Backend restart

Startup compares projected sessions with live adapter sessions (`apps/server/src/serverRuntimeStartup.ts:546-610`). Eligible running sessions with cursor and continuation policy are durably marked starting and continued (`:625-652,711-799`); others become stopped/error (`:653-709,803`). Browser reconnect is transparent; backend restart continuation is conditional and must be included in child design.

---

## 4. What the Die patch does today

### Outer thread is backend-owned

The launcher seeds T3 provider instance `pi` with Die as `binaryPath`, exports `DIE_WEB_DIE_BINARY`, and enables task events (`src/web/launcher.ts:35-76`). Pi provider recognizes web mode (`apps/server/src/provider/Layers/PiProvider.ts:123-203`). Per T3 thread, Pi RPC launches `<die> --mode rpc ... --session <T3-owned file>` (`apps/server/src/provider/pi/PiRpcClient.ts:329-385`; `PiAdapter.ts:2018-2036`). This is a genuine T3-owned executable process.

### Subagent is Die-owned

`subagent` enforces max depth two, orchestrator-only delegation, and no nested orchestrator spawning (`src/tasks/job-service.ts:153-164`). It persists a distinct child session with parent link/identity (`src/tasks/agent-session.ts:10-30`) and spawns:

`process.execPath --session <child> --mode json -p --model ... -- <prompt>`

(`job-service.ts:169-205`). `TaskManager` launches a detached process/group and tracks PID/status/output (`src/tasks/task-manager.ts:169-220,232-284`). `jobs.stop` sends SIGTERM then SIGKILL (`:423-442`); session shutdown stops children with a bounded watchdog (`:445-494`). These are real processes, but their control plane is parent Die.

Nested execution is real inside Die: identity/depth is restored and capability-capped (`src/tasks/extension.ts:127-187`), and each process owns its own TaskManager. The root manager does not own grandchildren.

### T3 sees lifecycle cards only

In RPC web mode, Die emits only spawn/completion NDJSON with ID, status, command, and bounded agent metadata. It omits session path, PID, output, ancestry, and controls (`src/tasks/web-events.ts:9-65`). PiAdapter stores these under the parent session and emits `task.started/completed` anchored to the parent turn (`apps/server/src/provider/Layers/PiAdapter.ts:1545-1632`). Provider ingestion persists parent-thread activities (`apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:608-619,777-783,2123-2182`). Background liveness intentionally folds nested agents into the same thread (`apps/server/src/orchestration/ThreadBackgroundLiveness.ts:44-71`). Tests prove lifecycle events share parent turn/task identity (`PiAdapter.test.ts:1120-1194`), not that children are threads.

### Result and stop today

Task completion is formatted into a bounded result preview (`src/tasks/completion-notification.ts:48-82`) and injected into the parent Die as custom `task-complete` steer with `triggerTurn: true` (`src/tasks/extension.ts:226-265`). Print/JSON mode holds the idle boundary until completion/attention and flushes (`:445-529`). Result delivery is local to parent Die.

Outer T3 interrupt aborts the RPC turn and Pi propagates the tool AbortSignal to child processes (`PiAdapter.ts:2400-2405`). If detached Die jobs outlive the turn, interrupt closes the owning parent session so Die shutdown kills them (`:2374-2394`; test begins `PiAdapter.test.ts:1198`). There is no current T3 operation to stop one lifecycle card/task ID.

---

## 5. Proved support vs extension

| Capability | Status |
|---|---|
| Independently executable/viewable top-level T3 threads | **Proved** |
| Multiple T3 Pi/Die processes keyed by distinct ThreadIds | **Proved** |
| Browser reconnect without restarting work | **Proved** |
| Per-T3-thread interrupt/session stop | **Proved** |
| Provider-dependent stopped-thread resume | **Proved** |
| Dormant Claude/Codex import then continuation | **Proved** |
| Die subagents are independent OS processes/session files | **Proved** |
| Die subagents are independent T3 threads | **Not supported** |
| Per-child control from current web card | **Not supported** |
| Cross-process Pi session-file lease | **Not supported** |
| Parent/child T3 graph and exactly-once result routing | **Not supported** |
| Nested spawning as T3 child threads | **Not supported** |

---

## 6. Alternative A: read-only projected child threads

Keep current Die execution, but register and mirror each child as a T3 thread.

Required work:

1. Extend lifecycle transport with child session ID/path, parent task/thread, depth/type/model, timestamps, and stable spawn ID. Current transport lacks them.
2. Add durable parent/child/external-execution relation; current thread schema cannot represent it.
3. Have a server reactor idempotently create a child projection from stable spawn ID. Command receipts help, but a durable spawn→thread mapping is still required.
4. Tail/read the child session file **read-only** and project child messages/activities. Existing `thread.history.import` is batch text history, not live projection; importer has no Pi source.
5. Mark the child `external-live/read-only`. Server must reject turn start, model/mode change, revert, and provider resume while Die owns the writer. UI hiding alone is insufficient.
6. Add backend→parent-Die `job.stop/inspect/input` transport. Current PiRpcClient offers prompt/abort, not jobs (`apps/server/src/provider/pi/PiRpcClient.ts:329-349`), and task events are one-way.
7. On child exit, either remain read-only or atomically transfer ownership after final flush, with a Pi cursor and cross-process lock/lease.

Semantics:

- Independently viewable: yes.
- Independently executable through normal T3 commands: no, until ownership handoff.
- Stop: proxied to owner; unavailable if owner channel is gone.
- Browser reconnect: projection works.
- Backend restart: requires owner rediscovery; TaskManager recovery is not proven.
- Nested children: descendant events must reach a common registrar or be forwarded with ancestry; root currently sees only direct jobs.
- Results: keep Die as sole result deliverer. If T3 also injects results, parent sees duplicates.

This is valid for viewability and proxied control, but it must never open the live file as a second T3 provider writer.

---

## 7. Alternative B: backend-owned child execution

This directly satisfies independent execution/control.

**Single-executor rule:** in web mode `subagent` must either use local `TaskManager.spawn` or request a T3 child—never both. For backend-owned mode, T3 creates the child thread and initial turn. Normal ProviderCommandReactor starts a new Pi/Die RPC session and owns its new file.

Required work:

1. **Bidirectional delegation bridge.** A web-mode jobs implementation sends structured spawn requests out of parent Die instead of spawning locally. Use a dedicated authenticated local channel or new Die RPC extension frames handled above PiAdapter; avoid a cyclic PiAdapter→OrchestrationEngine dependency.
2. **Durable spawn coordinator.** Persist spawn ID, parent thread/turn/task, child thread, depth/type/model/prompt, state, terminal sequence, and result-delivery state. Derive deterministic child/command IDs so retries cannot create/run twice.
3. **Parent/child contract and projections.** Add explicit graph metadata for UI navigation/grouping/cascade behavior.
4. **Atomic create/start.** Reuse `thread.turn.start.bootstrap.createThread`, avoiding a visible child without its durable first prompt.
5. **Profile mapping and nested policy.** Resolve Die fast/normal/orchestrator profile to T3 model/modes. Persist/enforce depth and capability server-side. A child Die can recursively request another T3 child.
6. **Exactly-once result channel.** Observe child terminal projection, persist a delivery receipt, and inject one typed custom result into the parent provider. Ordinary `thread.turn.start` would incorrectly create a user message. Add a custom provider/Die command equivalent to current `sendMessage(... deliverAs: steer, triggerTurn: true)`.
7. **Jobs API compatibility.** Return a child task/thread handle. In backend-owned web mode, `jobs.list/inspect/stop` proxies to coordinator/thread operations.
8. **Stop policy.** Child UI Stop dispatches that child's interrupt/session stop. Define persisted cascade-vs-detach semantics for descendants; do not rely on accidental process-group relationships.
9. **Recovery.** Browser reconnect is inherited. On backend restart, rebuild coordinator state, use provider-session reconciliation for children, and redeliver terminal-but-undelivered results once.

This fits T3 because every child receives existing command receipts, serialized event writes, projections, detail stream, provider binding, interrupt/stop, and cursor recovery. No component tails a foreign live writer.

---

## 8. Double-run/double-write invariants and race tests

An implementation should enforce:

1. One durable child ThreadId and accepted initial turn per `spawnId`.
2. Backend-owned child is never locally spawned; external-live child never starts a T3 provider session.
3. One session-file writer. Ownership transfer requires external exit/flush plus OS lock or durable lease; the current map is insufficient.
4. One message/event source: transcript mirror and provider ingestion never overlap. Transfer at a durable watermark.
5. One result delivery, keyed by child terminal sequence and persisted receipt.
6. One stop authority: ProviderService for backend-owned, owner bridge for projected.
7. Explicit parent/child edges and depth for nested stop/result routing.

Tests should crash/race at: request before create; create before provider start; process start before binding update; completion before result receipt; receipt before parent injection; disconnect during stop; nested parent completion before child; and ownership transfer while a live writer remains.

## 9. Comparison

| Concern | Current cards | Read-only projection | Backend-owned child |
|---|---|---|---|
| Real process | Yes, Die-local | Same | Yes, child T3 provider |
| Separate T3 route | No | Yes | Yes |
| Direct follow-up | No | Reject until handoff | Yes |
| Stop one child | Die jobs only | Proxy | Native child interrupt/stop |
| Browser reconnect | Parent activities | Child projection | Full child state |
| Backend restart | TaskManager recovery not proven | Owner rediscovery | Provider/coordinator recovery |
| Nested children | In-process hierarchy | Forward/register descendants | Durable recursive thread graph |
| Result | Die custom steer | Keep Die sole owner | Durable exactly-once coordinator |
| Double-write risk | None | High unless strictly read-only | Low; backend sole owner |

## Conclusion

Pinned T3 already provides the execution substrate, but the canonical patch deliberately stops child visibility at provider task activities. The strongest route is backend-owned child execution: make web-mode `subagent` a durable T3 spawn request, create/start an ordinary child thread, let its own Pi/Die provider session own the process/file, and route results through a durable parent/child coordinator. Read-only projection is a legitimate alternative if preserving Die-local execution is more important, provided controls are explicitly proxied and T3 is barred from resuming the live file. The unsafe option is a hybrid that both retains the local child and starts a T3 session against the same execution/session.
