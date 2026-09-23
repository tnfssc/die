# Die ↔ T3 child-thread architecture research

Date: 2026-09-20  
Scope: architecture research only; no implementation changes  
T3 source reviewed: pinned Die web revision `719a76ca1dbf5490f1aa33ffb9966301e02be9a9` in `.cache/die-t3code-v0042`, with the staged Die web patch applied. This distinction matters: references to `PiAdapter.ts` include Die-specific staged behavior, while contracts/orchestration are the pinned T3 codebase.

## Executive conclusion

“show orchestrator threads in T3” can mean three different products:

1. **Richer task observability in the parent T3 thread**: improve the current task and agent cards. This is low risk and keeps Die in control. It does **not** create selectable T3 threads.
2. **Selectable projection of Die-owned child sessions**: create T3 thread read models for child session files. Die stays the sole execution owner. This is the best step toward selectable threads. The first release must say that projected child threads are read-only, or stop-only, while active. This keeps current completion behavior and avoids two writers on one Pi session file.
3. **T3-backend-owned child execution/delegation**: make each delegated child a native T3 provider session and thread. Then bridge its result back to the orchestrating Die session. This gives the cleanest interactive UX in the long run. But it rewrites the delegation runtime rather than adding observability. It needs a durable two-way broker, result delivery, nested delegation, and restart behavior before it is safe.

**Recommendation:** choose option 2 next. Use option 1's richer event payload as the transport base. Do not claim steering in the first projection release. Current child agents run in print/JSON mode with stdin closed, so they have no valid steering seam. Add individual stop through a narrow parent-owned control channel if needed. Consider option 3 only if “compose in any child thread while it is running” and restartable delegated execution are hard requirements. Those requirements justify the extra ownership machinery.

Do **not** replace the runtime with an in-process `AgentHarness`/embedded `AgentSessionRuntime` just to get threads. The installed Pi package exposes useful embedded APIs, but T3 already has a functioning Pi RPC adapter and canonical event translation. No observed deficiency here is caused by process isolation itself; the missing pieces are identity projection, control routing, and durable result ownership.

---

## 1. What Die actually runs today

### 1.1 The child is an OS process and a real, separate Pi session

`prepareAgentSession()` creates a new Pi `SessionManager` with `parentSession`, immediately persists a header, reopens it, and writes a `die-agent` custom entry containing type/model/thinking/depth and a generated task ID. It returns that stable task ID plus the child session file. See:

- `src/tasks/agent-session.ts:5-26`
- especially header persistence at lines 13-20 and identity metadata at lines 21-26.

`JobService` then starts `process.execPath` (the Die executable) with:

- `--session <child-session-file>`
- `--mode json -p`
- model/thinking arguments and the prompt
- `DIE_SUBAGENT_DEPTH` / `DIE_SUBAGENT_TYPE`
- **`closeStdin: true`**

See `src/tasks/job-service.ts:153-205`, particularly lines 173-203. This is important: these are already separate conversational histories, but they are not interactive Pi RPC sessions. Generic `jobs.input` exists, yet agent stdin has already been ended, so it is not a steering mechanism for subagents.

`TaskManager.spawn()` owns the child process, process group, pipes, completion promise, and bounded output in memory (`src/tasks/task-manager.ts:169-215`). It parses agent JSON output through `AgentProgress`; raw model events update activity while selected text/tool summaries are retained (`task-manager.ts:211-229`; `agent-progress.ts:70-151`). On completion it resolves the wait, emits a completion event, and optionally notifies the owner (`task-manager.ts:238-275`).

### 1.2 Task state is process-local; the lifecycle journal is diagnostic, not a task database

`TaskManager` keeps all tasks in a private in-memory `Map` (`task-manager.ts:139-150`). It exposes snapshots/events, not handles, through `list`, `pending`, `inspect`, `wait`, and `subscribe` (lines 287-330). Output is bounded and old completed output is evicted under an aggregate budget (lines 497-518).

The sidecar `<owning-session>.jobs.jsonl` contains lifecycle-only records. Its own comment says it “never includes commands, prompts or output” and is bounded to 2 MiB (`src/tasks/task-lifecycle.ts:14-18`). Writes use a Linux/x64 nonblocking `flock`, validate inode/mode, append a bounded line, and may drop a record on contention (lines 88-174). The extension writes spawned/stopping/completed records with task ID, kind/status/timestamps/termination and child `sessionFile` (`src/tasks/extension.ts:312-370`).

So the journal can support reconciliation and identity recovery, but it cannot reconstruct a running `TaskManager`, output cursor, control handle, prompt, or final answer.

### 1.3 Session files have a single-writer assumption

Die's disk-backed session store opens the active JSONL file and appends entries. Its rollback comment explicitly calls it a **“Single-writer journal”** (`src/history/disk-entry-store.ts:359-384`). The manager keeps offsets and in-memory indexes after each append (lines 388-411). There is no per-append interprocess transcript lock analogous to the lifecycle sidecar lock.

This forbids a projection implementation from opening a live child session as a second writable Pi session. Reading/tailing is feasible; ownership transfer or concurrent resume is not.

### 1.4 Completion returns to the parent conversation, not to an external coordinator

A foreground subagent call waits briefly and then transfers notification ownership when it backgrounds (`src/tasks/job-service.ts:230-237`; `TaskManager.foreground`, `task-manager.ts:333-389`). Completed jobs are batched and injected into the owning Pi conversation via:

`pi.sendMessage(..., { deliverAs: "steer", triggerTurn: true })`

See `src/tasks/extension.ts:227-267`. This is the current async result-return contract. It is model-visible, causes the parent agent to resume, and has delivery/ack safeguards in the local execute job bridge.

The execute job bridge itself is a useful pattern but not a T3 IPC seam today. It is a local framed socket protocol scoped to one execute call (request: id/method/params; response plus acknowledgement) and its lifetime tracks response delivery (`src/typescript/job-bridge.ts:49-105`). It does not expose `TaskManager` to the T3 server.

### 1.5 Nested orchestration is intentionally bounded

Delegation is allowed only while `depth < 2`, and below the root only an `orchestrator` may delegate (`src/tasks/subagent-profiles.ts:70-72`). A spawned orchestrator may create only fast/normal workers (`src/tasks/job-service.ts:155-160`). Identity is restored from child session metadata on resume, not solely from environment variables (`src/tasks/extension.ts:552-559`).

Any T3-backed alternative must keep depth/type policy and parent-session lineage across backend launches; otherwise it silently changes safety boundaries.

---

## 2. What T3 and the current Die web patch provide

### 2.1 T3 threads are durable orchestration entities, not just UI rows

The T3 contract has durable commands for `thread.create`, `thread.turn.start`, `thread.turn.interrupt`, and `thread.session.stop` (`packages/contracts/src/orchestration.ts:1047-1062, 1238-1286, 1333-1344`). A created thread requires project/model/runtime/interaction metadata. A turn start carries a durable user message and optional bootstrap. T3 also has internal commands for assistant deltas/completion and history import (lines 1411-1468).

This means “make a task a thread” is not a cosmetic alias. Something must populate the T3 event/projection model, bind or deliberately not bind a provider session, and define what thread commands mean.

### 2.2 T3 already has a suitable provider abstraction and Pi RPC adapter

`ProviderAdapterShape` owns `startSession`, `sendTurn`, `interruptTurn`, user-input responses, `stopSession`, session lookup/listing, snapshots/rollback, and a canonical `ProviderRuntimeEvent` stream (`apps/server/src/provider/Services/ProviderAdapter.ts:67-158`).

The staged Pi adapter launches a Pi RPC process against a specific session file, tracks a lease per file, converts streaming assistant/reasoning deltas to canonical item/content events, supports prompt/steer and abort, and keeps a Pi resume cursor. Relevant evidence:

- session-file lease and `--session` launch: `PiAdapter.ts:1939-2058`
- event stream attachment: lines 2104-2146
- send/steer path: lines 2166-2369
- interrupt/abort path: lines 2374-2420
- adapter surface: lines 2451-2473.

Installed Pi RPC itself exposes `prompt`, `steer`, `followUp`, `abort`, queue clearing, session switching, entries/tree/messages, etc. (`node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-client.d.ts:62-90` and later methods). It does **not** expose a generic extension-defined RPC request in the reviewed command union; extension slash commands can be invoked through prompt text, but that is a conversational turn, not a clean control plane.

### 2.3 Current Die integration is lifecycle-card projection only

Die emits `die_task_event` NDJSON only in RPC mode with `DIE_WEB_TASK_EVENTS=1`. The schema includes started/completed, task ID/kind/status/command and agent type/model/thinking; it deliberately excludes activity, output, session file, parentage, and control address (`src/tasks/web-events.ts:9-43`). Activity events are discarded; transport writes directly to stdout and is one-way/best-effort (lines 46-66).

The staged T3 `PiAdapter` translates these into canonical `task.started` / `task.completed` events tied to the **current parent turn**, retaining a bounded in-memory `dieTasksById` map (`PiAdapter.ts:1551-1631`). It also recognizes the model-visible `task-complete` custom message as a compatibility completion source (lines 1714-1733). That is why lifecycle cards work but selectable child threads do not exist.

When only detached Die tasks remain, the patch's Stop behavior closes the whole owning Pi session to invoke Die shutdown (`PiAdapter.ts:2381-2394`). There is no individual task control path from T3.

### 2.4 T3 already demonstrates “project a transcript without running it”

The session importer creates a T3 thread, writes a stopped provider binding/resume cursor, and imports user/assistant messages (`apps/server/src/project/AgentSessionImporter.ts:222-274`). The history-import command accepts user/assistant text records (`orchestration.ts:1438-1450`). This is strong evidence that projection-only threads fit T3's model.

But the current scanner only recognizes `claudeAgent` and `codex` sources (`packages/contracts/src/agentSessions.ts:5-20`), not Pi/Die, and import is snapshot-oriented rather than live tailing. Also, imported threads are guarded against overwriting modified/active threads (`AgentSessionImporter.ts:196-220`), a useful precedent for ownership protection.

### 2.5 Restart behavior is explicit but does not recover Die TaskManager children

T3 durably stores provider session state/cursors. Startup reconciliation marks orphaned provider bindings stopped/error, with a special marked continuation path that can restart a provider session from a resume cursor and send a continuation turn (`apps/server/src/serverRuntimeStartup.ts:646-708, 711-775`).

A Die-owned child is outside that directory: after parent/server death there is no durable PID/control handle, no reconstructed TaskManager, and no guarantee the process was killed. Resuming its child session through T3 while an orphan is still writing would violate the single-writer constraint. The lifecycle sidecar can say what was last observed, but not establish liveness.

---

## 3. Feasible seams by capability

| Capability | Existing seam | What is missing |
|---|---|---|
| Stable identity | Die task ID plus child session file; lifecycle sidecar records both | T3 thread ID mapping and project/parent-thread linkage must be durable |
| Lifecycle | `TaskManager.subscribe`; web NDJSON started/completed | Progress/activity events, generation/sequence, replay/reconciliation |
| Transcript | Child Pi JSONL session is durable | Safe tail parser, branch semantics, message IDs, truncation/compaction handling; read-only while live |
| Progress | `AgentProgress` parses JSON and tracks phase/tool/activity | Current web event drops it; T3 needs canonical progress events or thread activity rows |
| Final result | Parent `TaskManager` extracts final answer and injects `task-complete` | Thread projection should mirror but must not steal delivery ownership |
| Stop | Parent has `TaskManager.kill(id)` with process-group TERM→KILL | Authenticated T3→parent request route and stale-owner response |
| User steer | Pi RPC supports steer, but Die child uses print JSON with closed stdin | Relaunch children under an RPC-owning proxy, or move ownership to backend |
| Background return | Completion batcher steers parent and triggers a turn | Backend-owned execution needs equivalent durable/exactly-once result delivery |
| Restart | Child session + lifecycle records persist | No task process reattachment; no safe liveness proof; no pending-result ledger |
| Nested orchestration | Depth/type in env and child session metadata | Backend/projected parent-child graph and policy propagation |

### IPC/control choices that are actually feasible

1. **Enrich existing parent Pi NDJSON output.** Best for one-way lifecycle/progress. It shares the established transport and PiAdapter parser. Add bounded records with sequence, parent session identity, child session identity, phase/output cursor and terminal summary. It remains best-effort unless paired with reconciliation.
2. **A local authenticated Unix-domain control socket owned by the Die parent extension.** Best minimal seam for `stop(taskId)`, `inspect`, and possibly event replay. It can reuse the job-bridge framing/ack ideas, but must have a session-scoped unguessable address/token and explicit ownership/generation. It dies with the owner, which is desirable: T3 then knows control is unavailable rather than guessing.
3. **Lifecycle sidecar as reconciliation only.** It is durable and already multi-process locked, but records can be dropped on contention and contain no content. Never use it as the live command bus.
4. **Read-only child session tailing.** Feasible for transcript projection if the tailer tolerates partial final lines and follows branch entry IDs. It must never instantiate a writable manager or resume provider execution while Die owns the file.
5. **Custom Pi RPC protocol extension or broker socket.** Required for full backend delegation. Existing Pi RPC commands do not provide a clean arbitrary extension-control request. A slash command is not an acceptable hidden control protocol because it creates turns/transcript effects and cannot provide robust asynchronous request/response semantics.

---

## 4. Option analysis

## Option 1 — Enrich process-owned agent-task observability

**Shape.** Keep every process and session under the parent Die `TaskManager`. Expand `die_task_event` and PiAdapter translation to include progress/activity, child session identity, bounded transcript/result snippets, nesting metadata, and sequence/reconciliation data. Continue rendering tasks/agents inside the parent thread.

### Behavior

- **Transcript/progress streaming:** progress is straightforward from `AgentProgress` and TaskManager activity. Full transcript should be linked/read from the child file rather than copied wholesale into the parent runtime event stream.
- **Stop:** whole-session stop exists. Individual stop needs a new parent control socket; otherwise no change.
- **User steer:** not feasible for current agent launches. `jobs.input` is misleading here because `closeStdin: true`; arbitrary stdin would not become a Pi steer even if left open.
- **Background result:** unchanged and strongest of all options; current completion batching remains authoritative.
- **Restart:** cards/events can be reconstructed partially from lifecycle + child session files, but running work cannot be reattached.
- **Nested orchestration:** unchanged and naturally represented as nested task metadata if child events are relayed upward; note that each nested child's events now go to its own stdout/owner, so parent aggregation needs explicit relay or T3 discovery through lifecycle/session lineage.

### Advantages

- Lowest risk and smallest contract change.
- No transcript writer conflict.
- Preserves exactly the tested Die execution and completion path.
- Useful foundation for either later option.

### Disadvantages

- Fails the literal requirement that child agents be selectable T3 threads.
- Parent thread can become crowded.
- T3 thread search/history/sidebar semantics remain unavailable.
- Individual control still requires new IPC.

### Verdict

Do this transport enrichment, but do not present it as the requested architecture. It is foundation, not destination.

---

## Option 2 — Project existing child sessions as selectable T3 threads, without ownership transfer

**Shape.** On agent start, T3 durably creates a child/projected thread linked to parent thread + Die task ID + child session file. Die continues to own the child process and completion. T3 tails the child session read-only and projects user/assistant messages and progress into its own event store. The UI selects it like any other thread, with an explicit “Die-owned / live projection” execution state.

### Required invariants

1. **Exactly one execution owner:** Die parent TaskManager until terminal/shutdown.
2. **Exactly one transcript writer:** child Pi process. T3 only reads while ownership is live.
3. **Result ownership remains with parent Die:** T3 projection must not consume, suppress, or duplicate the `task-complete` injection.
4. **Stable mapping is durable before exposure:** parent T3 thread, child T3 thread, task ID, session file identity/header ID, owner generation, nesting parent.
5. **No ordinary T3 turn command against a live projection.** Composer disabled unless a proven proxy-control implementation exists.

### How it can fit T3

T3's importer is a concrete precedent: create a thread and import history without an active session. A live projector would be incremental rather than one-shot and needs either new server-internal projection commands or reuse of user append/assistant delta-complete commands. A dedicated “external/live projection” binding is preferable to lying that the child is a normal stopped provider session.

The child session header and `die-agent` entry provide identity before model output. Started lifecycle event already occurs after TaskManager stores the task. Add child `sessionFile` (or safer opaque session ID plus server-resolved path) to the transport; do not expose arbitrary filesystem paths to browser clients.

### Transcript/progress streaming

Two complementary streams:

- **low-latency:** enriched parent NDJSON events with task sequence, phase/current tool/activity and terminal summary;
- **authoritative transcript:** server tails Pi JSONL, indexes entry IDs/parent IDs, and emits T3 messages. On reconnect it resumes by file identity + byte offset/entry ID and reconciles against durable projected entries.

The tailer must handle partial lines, file replacement/migration, branch changes, compaction/custom entries, bounded reads, and session-file path validation. Die's own `DiskEntryStore` scanner has useful parsing behavior, but importing it into T3 couples packages; a format contract or isolated parser is safer.

### Stop and steer

- **Stop:** feasible with a small authenticated backend→parent control request, routed to `TaskManager.kill(taskId)`. The projected thread Stop button should say it stops the Die task, not a T3 provider session. TERM→KILL remains owned by Die.
- **Steer:** **not now feasible.** The child is not RPC mode and stdin is closed. Options are: (a) leave composer disabled; (b) evolve Die's child runner so the parent owns a Pi RPC client and exposes `steer` through its control socket; or (c) move to option 3. (b) is still Die ownership and may be a later option-2 enhancement, but it is a substantial runner change.

### Background result return

Unchanged: parent receives the completion and resumes through `pi.sendMessage`. T3 marks the projected child terminal from the same task completion event and transcript reconciliation. Include an event/result ID so a reconnect cannot show duplicate terminal messages.

### Restart constraints

On T3 restart while parent Die is alive, the parent NDJSON channel usually restarts with the owning Pi process, so all processes may be torn down. If a control socket survives an adapter reconnect scenario, T3 can re-handshake and replay current tasks. Otherwise:

- mark projection “owner disconnected / unknown,” not running;
- consult lifecycle sidecar and child transcript for last observed state;
- never resume that child file until orphan liveness is resolved;
- default to terminal “interrupted by owner shutdown” after bounded process ownership cleanup;
- do not claim restart continuation.

A future safe handoff needs a coordinated lease release from Die and lease acquire by T3. File age/PID existence alone is not enough.

### Nested orchestration

Each projected child can have projected children. The durable graph should use explicit parent task/thread IDs, not infer solely from `parentSession` paths. Keep depth and agent type. The root T3 thread remains the result recipient for direct children; nested completion still flows through each child's own Die runtime exactly as today.

### Advantages

- Delivers selectable threads without rewriting execution semantics.
- Reuses real child session files and T3's durable projection/search/sidebar.
- Allows staged delivery: visibility first, stop second, steering only after a valid runner seam.
- Failure does not threaten child execution; projection is observational.

### Disadvantages

- Two state models must reconcile.
- A selectable but temporarily read-only thread needs clear UX.
- Live session tailing and T3 message mapping are nontrivial.
- Restart cannot recover execution with current TaskManager.

### Verdict

**Recommended near-term architecture.** It is the only option that meets selectable-thread visibility while preserving proven Die behavior and single-writer safety. Treat read-only live projection as an explicit product property, not a temporary hidden limitation.

---

## Option 3 — Backend-owned thread execution/delegation

**Shape.** A Die `subagent` call becomes a request to a T3 delegation broker. The backend durably creates a T3 thread and starts a native Pi provider session through `PiAdapter`. It streams events normally. It returns a task/thread handle to Die and eventually sends the final result back to the parent Die conversation.

### Required protocol (not present today)

At minimum:

1. parent extension → backend: spawn request with request ID, parent session/thread, prompt, cwd/project, profile/model/thinking, depth/type, timeout, wait/background policy;
2. backend → parent: durable acceptance with task ID + T3 thread ID;
3. parent ↔ backend: wait/inspect/stop/steer and event/result acknowledgement;
4. backend → parent: terminal result with idempotency key;
5. parent → backend: acknowledgement that result was injected into the parent conversation;
6. reconnect/restart: query unacknowledged results and current delegated tasks.

The existing per-execute job bridge shows acknowledgement semantics, but it is process-local and ephemeral. It would need a session-level durable counterpart. The existing Pi stdout custom event is one-way and cannot implement this protocol.

### Transcript/progress streaming

Best of all options: T3's PiAdapter already maps native Pi stream events to canonical thread/turn/item/content/task events. No file tailing is needed for normal operation, and T3 controls the resume cursor.

### Stop/user steer

Best of all options: native T3 `thread.turn.interrupt` and new turns route to `PiAdapter.interruptTurn/sendTurn`; Pi RPC supports steer while active. The product must still define whether text typed into a child thread is:

- steering the current delegated tool call,
- a follow-up after it,
- or an independent later turn whose result no longer belongs to the original parent tool call.

That semantic decision affects when the parent considers the subagent complete.

### Background result return

This is the hardest seam. A T3 thread completing is not enough; Die's orchestrator expects a bounded tool result or later model-visible completion notification. The backend must summarize/extract the child answer, deliver it to the owning parent extension, and keep current foreground/background ownership transfer. Generic `PiAdapter.sendTurn` to the parent would look like a user message and is not equivalent to the current `customType: task-complete` steer. A custom extension-facing RPC/broker delivery command is needed.

If the parent is offline, the result needs a durable outbox. On resume, the extension must drain it exactly once (or idempotently) and trigger the parent turn. This adds state beyond T3's child thread.

### Restart constraints

T3 has cursor-based provider restart machinery and a marked continuation path, but delegated-task correctness needs more:

- whether an interrupted child turn is resumed with a synthetic continuation or marked failed;
- preservation of delegation request/task/result IDs;
- an outbox for results not acknowledged by the parent;
- timeout semantics across downtime;
- cleanup of stale provider processes and leases;
- deterministic parent notification after both parent and child restart.

Current T3 startup code can reconcile its provider sessions; it cannot reconstruct the missing parent-tool-call/result-delivery transaction without this new ledger.

### Nested orchestration

To make nested children T3 threads too, backend-launched child Die sessions must receive broker credentials/context and send their own delegation requests back to T3. Policy must remain authoritative in Die or be duplicated with versioned validation in the broker. If only root delegation is backend-owned while child orchestrators use local TaskManager, the system becomes hybrid; that may be acceptable, but the UI/ownership model must say so.

### Advantages

- Fully native, selectable, interactive T3 threads.
- Canonical streaming and individual stop/steer already fit provider abstractions.
- Strongest route to deliberate restart continuation.
- Backend has authoritative thread/task ownership.

### Disadvantages

- Largest implementation and correctness surface.
- Changes Die's core delegation and completion semantics.
- Needs durable bidirectional IPC, security, leases, outbox/idempotency, and nested policy propagation.
- Backend availability becomes a dependency of `subagent` in web mode.
- Risk of behavior divergence between TUI/CLI and web unless broker ownership is carefully scoped.

### Verdict

Choose only for a firm requirement of writable/steerable live child threads or durable backend execution. It should be designed as a delegation broker project, not smuggled into the lifecycle-event adapter.

---

## 5. Decision matrix

Scores: 5 = strongest/best, 1 = weakest/highest risk. “Current” means with no unproven extra subsystem.

| Criterion | 1. Enriched tasks | 2. Projected child threads | 3. Backend-owned threads |
|---|---:|---:|---:|
| Selectable T3 thread UX | 1 | **5** | **5** |
| Preserves current Die execution | **5** | **5** | 2 |
| Implementation size/risk | **5** | 3 | 1 |
| Live transcript fidelity | 2 | 4 (tail/reconcile) | **5** |
| Progress visibility | 4 | 4 | **5** |
| Individual stop, current seams | 1 | 3 (new narrow control IPC) | **5** |
| User steer, current seams | 1 | 1 | **5** |
| Parent async result correctness | **5** | **5** | 2 (new durable outbox needed) |
| Single-writer safety | **5** | **5 if read-only** | **5 if ownership starts in T3** |
| Restart visibility | 2 | 4 | 4 |
| Restart execution continuation | 1 | 1 | 3 now / 5 after new ledger semantics |
| Nested orchestration preservation | **5** | 4 | 2 until broker propagation is designed |
| T3-native search/sidebar/history | 1 | **5** | **5** |
| Failure isolation from UI/backend | **5** | 4 | 2 |
| Overall fit for stated visibility goal | 2 | **5** | 3 unless interaction is mandatory |

### Decision rule

- If “visible” means richer cards only: option 1.
- If “visible as separate/selectable threads” is the requirement, but Die remains the runtime: **option 2**.
- If users must type into/steer child threads while the original delegation is live, or delegated execution must be backend-restartable: option 3 (or a later option-2 RPC-runner enhancement, which begins to approach option 3 complexity).

---

## 6. Suggested staged architecture (no implementation prescribed here)

### Stage A — Event/identity contract

Define a versioned server-only child-task envelope with:

- owner parent session ID and T3 thread ID (bound server-side, not trusted from child);
- task ID, child session header ID, opaque server-resolved session locator;
- parent task/thread for nesting;
- monotonically increasing sequence and owner generation;
- state/phase/current tool/activity timestamp;
- bounded terminal result metadata and termination cause.

Keep browser contracts path-free. Add a startup/current-state snapshot so event loss does not permanently desynchronize T3.

### Stage B — Read-only projected T3 child threads

Create a dedicated external-projection marker/binding. Import/tail transcript entries. Disable composer and provider resume while owner lease is live. Keep task completion delivery unchanged.

### Stage C — Individual stop

Add a narrow authenticated local control endpoint at the Die parent. Support identity handshake, list/snapshot, stop, and perhaps inspect. Route T3 projected-thread Stop to owner. Do not add generic arbitrary method execution.

### Stage D — Decide whether steering justifies runner ownership work

Either:

- keep projected children read-only for their live delegated turn;
- change the Die-owned child runner from print mode to parent-proxied Pi RPC and expose steer; or
- adopt backend delegation (option 3) with a durable broker/outbox.

Make this a product decision before coding because each choice changes completion semantics.

---

## 7. Why not replace the runtime with AgentHarness / embedded Pi now

The installed package contains `AgentSessionRuntime` and `createAgentSessionRuntime` APIs, so in-process execution is technically possible (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session-runtime.d.ts`). But no reviewed evidence shows it solves the actual blockers:

- T3 still needs durable parent/child thread identity.
- Parent result ownership and idempotent async delivery still need a protocol.
- Concurrent session-file writers are still unsafe.
- Nested delegation policy and restart semantics still need design.
- T3's existing PiAdapter already provides process isolation, RPC streaming, steer/abort, model switching, session cursoring, and canonical runtime events.

Embedding could reduce one process boundary, but would couple T3 to Die extension loading/global configuration and move failure/resource isolation into the server. That is cost without demonstrated architectural benefit for this goal. Reconsider only if measurements prove RPC process overhead or protocol limitations are the dominant problem after the ownership model is chosen.

---

## 8. Unknowns that must be resolved before implementation

### Product/semantics

1. Must a projected child thread be writable while its original parent tool call is live, or is selectable read-only observation acceptable?
2. If a user sends a child follow-up, does the parent receive the new answer too? When is the original task terminal?
3. Should command jobs become threads, or only agent jobs?
4. Should nested workers appear in the same project/sidebar or under a parent-thread hierarchy?
5. What should Stop mean after the parent Pi turn ended but detached tasks remain: one child, all children, or owning session?

### Runtime/control

6. Does Pi print mode offer any supported interactive command channel not visible in the installed declarations? Reviewed APIs say no; verify with an integration probe before ruling out a low-cost steer route.
7. Can the parent Pi RPC transport safely carry additional custom records with replay/sequence guarantees, or should live state use a separate socket from day one?
8. On server shutdown, does the packaged process supervisor reliably kill the parent Pi process group and all detached grandchildren on every supported OS? TaskManager uses detached process groups on non-Windows, but parent/server grouping needs an end-to-end test.
9. How should Windows work, where Unix-domain socket/process-group assumptions differ?

### Session projection

10. Which Pi session entry types/branch semantics should become T3 messages, especially compaction/custom/task-complete entries?
11. Can Pi rewrite/replace a live session file during fork/migration, and what stable file identity should the tailer track?
12. How are partial lines, truncated/corrupt tails, and very large tool records bounded?
13. Does a projected thread need its own model selection/provider instance when it must not be resumed by T3?
14. Should T3 later acquire a stopped child's session for follow-up? If yes, define an explicit Die lease release and T3 lease acquire protocol.

### Durability/security

15. Where is task↔thread↔session mapping stored, and how is it garbage-collected with thread/session deletion?
16. What is the trust boundary for session file paths emitted by a child process? Prefer server-known roots plus header validation and opaque IDs.
17. What replay/idempotency key prevents duplicate terminal projection and duplicate parent result injection?
18. For option 3, what durable outbox survives parent and server restarts, and who owns retries/timeouts?

### T3 contract maintenance

19. Should external projected execution be a new provider adapter/binding type, or an orchestration projection with no provider session? Reusing “stopped imported session” while live would be misleading.
20. Are server-internal thread creation/history commands stable enough for live projection, or should a first-class child-thread ingestion service own this behavior?
21. How will upstream T3 updates keep the extra projection/control contracts without expanding the already large patch surface?

---

## Final decision statement

The runtime evidence does not support transferring existing child-session ownership just to make the UI look threaded. Die already creates proper separate Pi sessions; the missing layer is a T3 projection and control bridge. Build that projection read-only first, keep Die as sole process/transcript/result owner, and use an explicit owner lease. Add individual stop through a narrow control IPC. Do not advertise steering until children are launched under a real RPC owner.

If writable live child threads are non-negotiable, skip half-measures and design backend-owned delegation as a durable broker with acknowledged result delivery. That is the point at which T3 ownership provides enough benefit to justify changing the runtime.
