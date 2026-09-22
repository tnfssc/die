# T3 task / subagent / thread / workflow GUI and persistence research

## Scope and source provenance

Research target: T3 Code at `web/t3-source.json` revision `719a76ca1dbf5490f1aa33ffb9966301e02be9a9`, plus `web/t3.patch`.

There is a cache provenance mismatch worth preserving as an assumption: `.cache/die-t3code` is a grafted checkout at `6f00d3881a197dd33c2cb43c6a11a9e759e56089`, with the patch represented as working-tree changes/untracked files, while the manifest names the later `719a76c` revision. I compared the central files directly against GitHub raw content at `719a76c`: `subagentRuntime.ts`, `AgentsPanel.tsx`, and `ThreadBackgroundLiveness.ts` are identical; task-related portions of `providerRuntime.ts`, `ProviderRuntimeIngestion.ts`, `ProjectionSnapshotQuery.ts`, `session-logic.ts`, and `ChatView.tsx` are materially unchanged (intervening changes concern Pi raw-source registration, title/worktree/queue behavior). The conclusions below therefore apply to the requested revision. Patch-specific Pi/die behavior is called out separately.

No product files were changed for this research.

## Executive conclusion

The current T3 UI can show **separate task identities as lifecycle/status summaries** inside one parent T3 thread. It can group workflow coordinators and workers, show status/model/role/latest summary/token totals/duration, expand timeline spawn summaries, and show a workflow script. It cannot show a full per-task transcript, navigate to a task as an independent T3 thread, send input to one task, or stop one task independently. Its only live control is the parent-thread interrupt/“stop everything” path.

The implemented source of truth is:

`ProviderRuntimeEvent task.* / tool.progress` → persisted parent-thread `OrchestrationThreadActivity` rows → thread snapshot/live subscription → client-side `foldSubagentActivities` → `AgentPanelModel` → timeline summaries / `AgentsPanel`.

This is explicitly a bridge modeled after a historical **T3 orchestration-v2** stack, not that stack itself. The current checkout has no orchestration-v2 contracts, server projection, migration, or subscription. `v2Projection` is a type-level/view-model seam with one unit test; there is no production caller or data source.

Separately, **Codex multi-agent v2** is an active provider-protocol integration in this checkout. Codex children are full Codex app-server threads internally, but T3 intercepts their child notifications and flattens them into the same parent-thread `task.*` lifecycle. “v2” in those Codex comments does not mean T3 orchestration-v2.

## 1. Current contract and data model

### Provider boundary

`packages/contracts/src/providerRuntime.ts:181-190, 558-733` defines the canonical provider events and payloads:

- lifecycle: `task.started`, `task.progress`, `task.updated`, `task.completed`;
- agent identity/linkage repeated on lifecycle rows: `taskType`, server-stamped `agentKind`, owning `agentId`, `title`, `role`, `model`, `effort`, `toolUseId`, `parentAgentId`, workflow name/index/phase/attempt, `runHandles`, `outputFile`, Codex `agentPath`, and `timelineBypass`;
- typed usage: total/input/cached-input/output/reasoning-output tokens, tool uses, duration;
- run handles: `runId`, `scriptPath`, `transcriptDir`, and sanitized HTTP(S) `sessionUrl`;
- task status: pending/running/waiting/idle/completed/failed/cancelled/interrupted.

`classifyTaskAgentKind` uses a denylist: monitor/background shell types are background, plan/dream are inert, and unknown future agent-flavored task types remain agents. Ingestion stamps the result into every persisted task row (`ProviderRuntimeIngestion.ts:366-409`). The client trusts the stamp; an old row without it is treated as background (`subagentRuntime.ts:111-121`).

The provider adapter SPI itself remains thread/session-scoped (`apps/server/src/provider/Services/ProviderAdapter.ts:67-158`): start/send/interrupt a thread turn, answer parent requests, stop a session, read/rollback the provider thread. There is no generic inspect-task, send-task-input, resume-task, or stop-task method/capability.

### Parent-thread projection contract

The public orchestration model has no Task/Subagent entity. `OrchestrationThread` contains `messages`, `activities`, plans, checkpoints, and one session (`packages/contracts/src/orchestration.ts:705-763`). An activity is intentionally generic: id, tone, open `kind`, summary, unknown payload, nullable parent turn, optional provider sequence, timestamp (lines 573-591).

There are no task-targeted client orchestration commands. Relevant commands are parent-thread turn interrupt and session stop (`orchestration.ts:1255,1308`). The shell/sidebar contract contains only aggregate `backgroundLiveness: working | monitoring | null`, not task rows (lines 791-849).

## 2. Provider event → durable projection

`ProviderRuntimeIngestion.runtimeEventToActivities` maps task events to thread activities (`apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:412-797`):

- start and terminal rows keep their event ids;
- meaningful progress uses stable id `task-progress:<thread>:<task>`;
- usage uses separate stable id `task-usage:<thread>:<task>`;
- agent-owned tool heartbeat uses stable id `tool-progress:<thread>:<task>`;
- progress detail is truncated to 180 characters by default (line 174);
- all linkage/run-handle fields are copied into activity payload JSON.

Stable ids mean progress is **latest state, not a log**. SQL upsert replaces the previous row under that id. Usage is separated so an activity tick cannot erase token totals and vice versa.

Ingestion dispatches `thread.activity.append` (lines 2238-2251). The durable domain event is `thread.activity-appended`; `ProjectionPipeline` upserts it into `projection_thread_activities` (`ProjectionPipeline.ts:1276-1300`). The table stores activity/thread/turn/tone/kind/summary/full `payload_json`/sequence/time, keyed globally by activity id (migration `005_Projections.ts:49-58`, sequence migration 008, repository `ProjectionThreadActivities.ts:58-125`). Rows are removed on thread recreation/deletion and rewritten on revert; there is no ordinary age-based SQL deletion.

The event store and SQL projection retain the full activity payload. Before data is sent to clients, `ActivityPayloadProjection` slims large tool data, but task lifecycle payloads have no `data` field and pass untouched; this is asserted at `ActivityPayloadProjection.test.ts:340-359`.

### Retention/read limits

Persistence is more durable than the delivered task roster:

- Thread-detail reads cap activities at the newest **500 per requested page/window** (`ProjectionSnapshotQuery.ts:96, 1369-1515, 1837-1942`). Only unresolved approval/user-input rows are pinned outside the recent window; agent rows are not (lines 1700-1835).
- The initial web thread window is the last **10 user-anchored turns** (`packages/client-runtime/src/state/threads.ts:49,785-810`). Older pages merge activities by id (lines 568-599), so manual “load earlier” can recover older rows, subject to each page’s 500-row cap.
- The in-memory legacy projector independently retains 500 recent activities plus pending async questions (`apps/server/src/orchestration/projector.ts:58-84`).
- The client fold caps its roster at **100**, preferring live, then idle, then newest settled agents; each agent has a six-entry, 180-character deduped recent-activity ring (`subagentRuntime.ts:107-139,669-680`). Because persisted progress/tool heartbeats are stable-id snapshots, a reload generally reconstructs latest summaries, not all live-observed ring entries.
- Every task lifecycle payload repeats identity to allow reconstruction after a start row leaves the 500-row window. Progress or completion can create an agent. This mitigates loss of the start, but if every row for an old settled task falls outside loaded history, that agent disappears from the roster.

## 3. Snapshot/subscription path

Web loads a thread-detail snapshot over HTTP and then subscribes to `orchestration.subscribeThread` with the snapshot sequence. The server attaches the live stream before replay, performs bounded event replay when possible, deduplicates by sequence client-side, and falls back to a (usually 10-turn) snapshot for invalid/oversized gaps (`apps/server/src/ws.ts:1917-2071`; contract comments at `orchestration.ts:913-985`). Live activity events also pass through `projectActivityEvent`.

The client reducer upserts activity by id and order (`packages/client-runtime/src/state/threadReducer.ts:666-724`). `threadDetail.ts:71-162` exposes messages, activities, plans, checkpoints, session, and latest turn as atoms. There is no task-detail atom or task subscription; every agent refresh is caused by the parent thread’s activity array changing.

The sidebar uses a separate shell subscription. Server-side `ThreadBackgroundLiveness` tracks task ids only in memory, categorizing agents versus monitors. Any agent wins as “working”; monitor-only is “monitoring”; idle/terminal removes liveness; session exit clears the thread (`ThreadBackgroundLiveness.ts:1-16, 67-143`). It deliberately does not survive server restart. Shell queries inject the aggregate into each shell row, and `Sidebar.logic.ts:816-845,1019-1045` resolves the Working/Monitoring pill. The sidebar has no task count, identities, transcript, or task navigation.

## 4. Client projection and per-agent semantics

`foldSubagentActivities` is a pure fold over the parent’s retained activities (`packages/client-runtime/src/state/subagentRuntime.ts:452-680`). It produces `RuntimeSubagent` with identity/kind/title/role/model/effort/status, activation count, latest usage/progress/tool/result/error/outputFile, workflow metadata/run handles, recent summaries, and timestamps (lines 52-88).

Important state rules, all covered in `subagentRuntime.test.ts`:

- terminal-first/order-robust reconstruction; late starts enrich but do not reopen;
- duplicate terminal frames are first-write for status/timestamps/result;
- terminal completion can still enrich missing result and usage;
- idle is resumable and nonterminal; explicit running after idle/reactivation increments activation count and clears prior terminal detail;
- dead parent session derives interruption for live agents but preserves idle/settled;
- workflow retries reuse stable member identity; coordinator settlement cascades to members missing terminal rows;
- malformed rows are skipped individually; unsafe session URLs are dropped;
- shells/monitors/plan tasks stay out; nested agent tasks remain in.

Usage is field-wise max-merged and never shrinks (lines 182-225). Codex emits cumulative child-thread totals, so this is correct. The current Claude adapter normalizes task-level progress as cumulative enough for this bridge, so it also max-merges here. This is not the same persisted activation accounting as historical orchestration-v2, where Claude accumulated per-activation deltas into lifetime usage.

`deriveAgentPanelModel` groups `kind=workflow` coordinators with members by `parentAgentId`, derives phase state, leaves orphaned members direct, excludes a coordinator-with-members from counts/token totals, and computes running/waiting/idle/settled totals (lines 683-861).

## 5. Thread detail, timeline, and AgentsPanel behavior

`ChatView` reads the active parent thread’s activities, folds them, and calls `deriveAgentPanelModel({ agents: ... })` (`apps/web/src/components/ChatView.tsx:2735-2759`). The same model drives:

- an inline spawn/workflow summary row in `MessagesTimeline`;
- the live-agent badge and background-work banner;
- the right-panel `AgentsPanel`.

The “quiet timeline” deliberately removes child narration/internal tools and collapses lifecycle to at most one spawn CTA per agent batch (`apps/web/src/session-logic.ts:389-509`). `AgentSpawnRow` can expand to one summary row per member and opens the Agents panel (`MessagesTimeline.tsx:3812-3882`), but member expansion contains only latest activity/result/error plus model and aggregate metrics (lines 3896-3965).

`AgentsPanel` is summary-only:

- `AgentRow` is explicitly “Flat, non-interactive … No unfold” (`AgentsPanel.tsx:139-191`);
- it shows title/role/status, elapsed time, one latest activity/result/error line, model/effort, aggregate tokens/tool count, activation count;
- workflows can expand/collapse phases and member rows;
- the only detail fetch is a read-only workflow **script** (lines 266-315, 377-455);
- footer totals working/idle/settled/tokens (lines 524-583).

It does not render `recentActivity`, `outputFile`, `transcriptDir`, `sessionUrl`, or `runId`. Repository-wide non-test usage confirms the only consumed run handle is `runHandles.scriptPath` in `AgentsPanel`.

The script RPC is narrowly contained to real `.js` files under `~/.claude/projects`, realpath/inode checked and capped at 256 KiB (`workflowScriptQuery.ts:1-35, 35-120`; containment tests in `workflowScriptQuery.test.ts`). The contract carries `threadId`, but `readWorkflowScript` currently receives/validates only the path; it does not verify that the path belongs to a run in that thread. Any transcript endpoint should improve on that ownership check rather than copy it blindly.

### Capability matrix (current UI)

| Capability | Current behavior |
|---|---|
| Show separate tasks | **Yes, as rows keyed by task id**, capped/retained as above. Workflows group coordinator/member rows. |
| Full per-task transcript | **No.** Child text is suppressed or summarized into lifecycle progress. No transcript schema/query/view exists. |
| Navigate to task/child thread | **No.** Agent rows are non-interactive and `RuntimeSubagent` has no canonical child `ThreadId`. |
| Inspect full output | **No.** Result/progress is bounded summary text. `outputFile` and transcript handles are unused. |
| Stop one task | **No.** No current task command/adapter method/UI action. |
| Stop all background tasks | **Yes, indirectly.** Composer banner calls parent `thread.turn.interrupt`; Codex interrupts tracked child turns before the parent (`CodexSessionRuntime.ts:2494-2525`). |
| Send input/resume one task | **No.** Parent structured-input handling is unrelated; no task target exists. |
| Show per-agent state/usage | **Yes.** Latest status and cumulative typed usage; activation history is only a count/current fields, not separately queryable records. |
| Retain settled agents forever in UI | **No.** SQL/event evidence remains, but snapshot page limits and 100-agent fold cap bound visibility. |

## 6. Run handles and transcript reality

Claude records workflow launch-ACK handles (`ClaudeAdapter.ts:3104-3137`) and repeats them on later task rows through `taskLinkageFor` (lines 1262-1285). `transcriptDir` is an absolute server-side path; `sessionUrl` is sanitized; `outputFile` comes from terminal task notification. They are persisted opaque metadata only. No generic contract says a handle is readable, retained, resumable, or controllable.

Claude explicitly drops subagent text/thinking from the parent transcript so parallel narration does not interleave; results reach UI through `task.*` summaries, while attributed tool blocks are re-homed away from the parent timeline (`ClaudeAdapter.ts:2686-2724`). Codex child `item` signals are converted to loose one-line `task.progress` summaries, not messages (`CodexAdapter.ts:1256-1285`). Thus a provider may possess a transcript while T3 intentionally does not project it.

## 7. T3 orchestration-v2 vs Codex multi-agent v2

### Historical T3 orchestration-v2 (#4779 stack)

Remote PR #4779, **“feat(orchestration-v2): subagent observability — data model and providers (1/4)”**, is closed and unmerged (head `c0a3852`; target branch `t3code/codex-turn-mapping`). Its scope was explicitly “nothing user-visible yet.” It defined real first-class projection entities:

- reusable `OrchestrationV2Subagent` with parent node, provider/canonical child thread refs, prompt, role provenance, workflow/membership, status, usage, activation count/current activation, recent activity;
- separately persisted `OrchestrationV2SubagentActivation` rows with ordinal/status/usage/timestamps;
- `subagent.updated` and `subagent-activation.updated` events;
- `OrchestrationV2ThreadProjection.subagents/subagentActivations`;
- migration 045 table `orchestration_v2_projection_subagent_activations` with thread/subagent/ordinal and run/status indexes;
- provider-specific cumulative-max versus activation-delta usage helpers.

Its tests covered contracts, migration/replay, provider ingestion/recovery/control, Codex continuation/nested fixtures, Claude workflow replay, and observability helper invariants. The following closed/unmerged stacked PRs matter when interpreting comments in current source:

- #4662 (2/4): attribute reused subagents to the driving run;
- #4663 (3/4): v2 Agents panel/run cards and `subagent.stop`; its own description says transcript/resume affordances were **later prerequisites**, not implemented. Stop was provider-capability based and Claude-specific underneath;
- #4664: timeline summary presentation over existing v2 projections.

The current revision contains none of `packages/contracts/src/orchestrationV2.ts`, `apps/server/src/orchestration-v2`, migration 045, the v2 subagent events/tables, or a v2 projection atom. Current comments and shapes are a legacy-port compatibility strategy, not evidence that v2 is running.

### Actual `v2Projection` support

Repository-wide callers are decisive:

- declaration and precedence only: `subagentRuntime.ts:727-740`;
- one unit test proving “v2 wins outright; sources are never merged”: `subagentRuntime.test.ts:530-539`;
- one ChatView comment saying it is null until v2 lands: `ChatView.tsx:2748-2751`;
- the sole production call omits `v2Projection` entirely (lines 2753-2757).

There is no adapter, atom, selector, contract decode, server query, or subscription that can supply it. It is therefore a **comments-and-function-parameter seam**, not latent production support. Even if a caller supplied data, the accepted type is the legacy `RuntimeSubagent[]`, not the richer historical v2 contract; an adapter would still have to map/discard fields such as `childThreadId` and activation records.

### Codex multi-agent v2 (implemented provider protocol)

`CodexSessionRuntime.ts:924-943` uses “multi-agent v2” for Codex app-server behavior: children are full **provider** threads identified by `thread/started source.subAgent.thread_spawn`, `subAgentActivity`, and their own turn/status/token-usage notifications. T3 registers/intercepts those children and emits synthetic `collabAgent/*` events. `CodexAdapter.ts:1035-1297` maps those to parent canonical `task.*` rows, uses child provider thread id as task id, marks them `timelineBypass`, and treats completed child turns as resumable `idle`.

This integration does **not** create separate T3 `OrchestrationThread` rows, routes, messages, or subscriptions. The child provider thread id is swallowed into task identity; `agentPath` is persisted but the current client fold does not expose it. Codex wire/runtime tests verify child traffic cannot leak into or mutate parent lifecycle and that captured fan-out maps to synthetic agent events (`CodexCollabWire.test.ts`, `CodexCollabRuntime.integration.test.ts`).

## 8. Patch-specific Pi/die behavior

`web/t3.patch` adds the Pi provider and a bounded `die_task_event` decoder (the Pi adapter is untracked in the cache because it is patch-added). At `PiAdapter.ts:1480-1590`:

- only valid `started/running` and terminal `completed|failed|killed` snapshots are accepted;
- at most 50 visible die tasks are tracked per Pi session;
- `kind=agent` emits `taskType=subagent`; `kind=command` emits `taskType=shell` and therefore stays out of Agents;
- title/role/model/effort are forwarded; the external id becomes `toolUseId`;
- terminal output is bounded to 2,000 chars there and then to the generic 180-char activity summary during ingestion;
- there are no progress frames, parent ids, transcript/run handles, usage, inspect offsets, attention, or task commands.

The patch therefore makes die agent jobs appear as distinct lifecycle summaries in the existing Agents UI, but does not change any UI capability in the matrix. Pi’s separate workflow decoder does provide workflow phases/members/usage and `runHandles.runId` (lines 1299-1425), still summary-only.

Tests in `PiAdapter.test.ts:1044-1420` cover original-turn retention, idle Die web shutdown, stock Pi interruption, task caps/malformed frames, sparse terminal status, and agent-vs-command projection; later tests cover Pi subagent/workflow lifecycle. They do not assert transcript navigation or per-task controls because those contracts do not exist.

## 9. Evidence-backed extension points (not a prescribed solution)

There are multiple viable product models; choosing one changes the correct persistence/navigation design.

1. **First-class task projection.** Revive/adapt the historical v2 shape: task identity, parent hierarchy, canonical/provider child refs, separate activation records, capabilities, attention, and retention. Add dedicated persisted tables/events and task snapshot/live subscriptions. This avoids reconstructing important state from a lossy 500-row activity window.
2. **Extend the activity bridge.** Keep `task.*` as source, but add a server materialized task table keyed by parent thread/task id and update it during ingestion/projection. The existing `RuntimeSubagent`/`AgentPanelModel` can remain a presentation adapter. This is less model replacement but must explicitly solve activation history, hierarchy, retention, and stale-session recovery.
3. **Canonical child threads.** If a task is conceptually an independently navigable conversation, create/link a T3 child `ThreadId` and use the existing message/thread-detail machinery. Historical v2 already had nullable `childThreadId`. Provider-native child ids alone are not safe T3 route ids and do not cover Claude/Pi/die uniformly.
4. **Task detail without child threads.** Add a parent-thread + opaque-task-id detail route/panel with a contained server query/subscription. Persist normalized transcript entries or query provider artifacts. Do not expose `transcriptDir`/`outputFile` as browser file paths; authorize ownership and cap/page reads. The workflow-script RPC is a containment pattern, but its missing thread ownership verification should be fixed for reuse.
5. **Capability-based controls.** Extend provider SPI and orchestration commands with explicit task capabilities (inspect/transcript, stop, input/close, resume, attention/watch/snooze as applicable), route by environment + canonical parent + opaque task id, and persist command/effect outcomes. Unsupported providers should omit capabilities rather than offer inert buttons. Parent interrupt should remain a distinct stop-all operation.
6. **Subscription strategy.** A full transcript needs task-scoped snapshot + monotonic sequence/replay semantics comparable to thread detail; lifecycle activity events are insufficient. Define behavior across browser reconnect, server restart, provider process loss, and transcript artifact expiry.
7. **Sidebar projection.** Decide whether sidebar remains aggregate liveness or gains task counts/attention. The current in-memory registry intentionally clears on restart and cannot represent durable waiting/review state.
8. **UI extension.** `AgentRow` can become navigable only after there is a stable address and capability model. `AgentsPanel` already has environment and parent thread ids, workflow grouping, and a right-panel surface; timeline spawn rows already open it. These are presentation extension points, not backend support.

## 10. Assumptions to validate before design

- Is one “task” a reusable agent identity, one activation, one process/job, or one navigable conversation? Current bridge conflates these into task id + activation count; historical v2 separated identity and activation.
- Must completed task transcripts survive server/provider restart, project deletion, revert, and provider cleanup? For how long, and with what privacy/storage cap?
- Should loading a parent’s old chat page also load its old task roster, or should task retention be independent of user-turn pagination and the 500-activity cap?
- Which providers genuinely support per-task input/stop/resume? Codex has child provider threads and tracked live turns but current code only exposes stop-all. Claude historical work relied on undocumented `stopTask`. Pi/die patch supplies no command channel in the event contract.
- Does die expose nested tasks, output pagination/offsets, attention, and routed control beyond the patch’s start/terminal snapshots? If not, T3 cannot manufacture full transcripts or independent controls.
- Are `transcriptDir` and `outputFile` stable and structured across provider versions, or merely debugging artifacts? What server-side parser/authorization owns them?
- Should workflow `sessionUrl` be rendered as an external provider UI, or should all detail remain local? Current UI intentionally ignores it.
- Is the closed orchestration-v2 stack expected to return, or should its comments/types be treated only as historical design evidence? No current production caller supports it.
- For nested agents, is `parentAgentId` always workflow membership? Current panel assumes that when the parent id names a workflow coordinator; a general task tree needs an explicit hierarchy separate from workflow grouping.

## Test evidence summary

The strongest current tests are:

- `packages/client-runtime/src/state/subagentRuntime.test.ts`: 40+ fold/model tests covering ordering, retention reconstruction, status/reactivation/idle, usage, workflow grouping/retries/cascades, URL sanitization, 100-row retention ordering, classification, and the lone synthetic `v2Projection` precedence test.
- `ProviderRuntimeIngestion.activity.test.ts` and task cases in `ProviderRuntimeIngestion.test.ts:4184-4450`: stable progress/usage persistence, lifecycle projection, title recovery after retained start/progress rows disappear.
- `ActivityPayloadProjection.test.ts`: task linkage/run handles survive client projection unchanged.
- `ThreadBackgroundLiveness.test.ts`: no restart from status-free late frames, idle/terminal behavior, agent-vs-monitor priority, nested-agent and reclassification behavior, isolated instances.
- `CodexCollabWire.test.ts` / `CodexCollabRuntime.integration.test.ts`: captured two-child fan-out, pre-registration child traffic, root self-activity exclusion, child lifecycle mapping, suppression from parent path, metadata lookup and no child leaks.
- `workflowScriptQuery.test.ts`: valid contained read, relative/non-js rejection, outside-root/symlink escape rejection.
- `session-logic.test.ts` and `MessagesTimeline.logic.test.ts`: quiet-timeline suppression, one CTA/batch, timelineBypass handling, state summaries.
- Patch-added `PiAdapter.test.ts`: bounded die task lifecycle plus Pi subagent/workflow event normalization.

What is notably absent: a current v2 projection integration test (there is no projection), task-detail/transcript tests, task navigation tests, and independent task stop/input tests.
