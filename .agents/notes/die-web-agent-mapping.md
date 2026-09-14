# die ↔ T3 full agent/task mapping

Research-only design note. No implementation, installs, provider calls, or commits were made.

## Provenance and decision

- die checkout: `1f7423e7a1ac78b8206d29a5e70230483b8d633c`.
- T3 checkout: `/home/tnfssc/Code/die-research/t3code` at `01e05c15268dedb76da95f442fbf5201cd8e7a44`.
- Context read: `die-web-backend-research.md`, `die-web-feasibility.md`, `die-web-t3-research.md`, and `die-web-opencode-research.md`. This note supersedes the temporary-bridge scope for agents/tasks; the earlier thin local-gateway conclusion still applies to the root chat/session transport.

**Decision:** add die as a real T3 provider driver and emit T3's existing canonical `ProviderRuntimeEvent` task lifecycle. Reuse ingestion, work-log collapsing, background liveness, spawn CTAs, and Agents panel. Do not make the browser parse Pi JSON, `.jobs.jsonl`, or die console text. Full nested observability/control needs a new **die-owned, versioned root task API/event stream** because current nested managers are process-local. T3 should adapt that API at its provider boundary; it should not recreate die task semantics.

T3's current agent model is itself explicitly a legacy task-event bridge pending an orchestration-v2 subagent projection (`packages/client-runtime/src/state/subagentRuntime.ts:1-18,726-740`). There is no current v2 subagent schema in this checkout to target instead. The canonical implemented seam today is `ProviderRuntimeEvent.task.* -> persisted OrchestrationThreadActivity -> RuntimeSubagent`.

## Canonical T3 schema and event path

### Envelope and lifecycle

Every provider event has `eventId, provider, threadId, createdAt`, optional `providerInstanceId, turnId, itemId, requestId, providerRefs, raw` (`packages/contracts/src/providerRuntime.ts:254-269`). The event union includes session/thread/turn/item/content/request/user-input/task/hook/tool/auth/error events; task event names are exactly `task.started`, `task.progress`, `task.updated`, `task.completed` (`providerRuntime.ts:151-200,232-235,1079-1105,1229-1283`).

| Concern | Canonical T3 representation | Exact semantics / caveat |
|---|---|---|
| Agent identity | `payload.taskId: RuntimeTaskId` | Reusable identity, not necessarily one activation. A completion may create the roster item if start retention expired (`subagentRuntime.ts:274-315,574-614`). |
| Hierarchy/linkage | Optional `taskType, agentKind, agentId, parentAgentId, title, role, model, effort, toolUseId, workflowName, agentIndex, phaseIndex, phaseTitle, phases, attempt, runHandles, outputFile, agentPath, timelineBypass` on every task payload (`providerRuntime.ts:626-730`) | `agentId` means **owning agent of this task/internal work**, while `parentAgentId` is roster hierarchy. They are not interchangeable. Ingestion stamps `agentKind`; clients trust it (`ProviderRuntimeIngestion.ts:366-409`). |
| Start | `task.started { taskId, description?, ...linkage }` | Fold creates/reopens a nonterminal identity and sets running (`subagentRuntime.ts:463-503`). |
| Progress/output summary | `task.progress { taskId, description, summary?, usage?, typedUsage?, lastToolName?, status?, error?, ...linkage }` | `description` is required. Ingestion maintains separate stable per-task latest-state and latest-usage rows, preventing activity/usage from erasing each other (`ProviderRuntimeIngestion.ts:623-698`). This is a bounded preview, not a log transport. |
| Nonterminal/status patch | `task.updated { taskId, status?, description?, error?, endedAt?, isBackgrounded?, ...linkage }` | Used for pause/idle/resume/wait/failure/interruption without pretending completion (`providerRuntime.ts:708-722`). |
| Completion | `task.completed { taskId, status: completed|failed|stopped, summary?, usage?, typedUsage?, ...linkage }` | Client maps `stopped -> interrupted`; first terminal status/time wins, but late completion enriches result/usage (`subagentRuntime.ts:429-446,574-614`). |
| Canonical UI status | `pending|running|waiting|idle|completed|failed|cancelled|interrupted` | `idle` is nonterminal/resumable; active is pending/running/waiting (`providerRuntime.ts:682-692`; `subagentRuntime.ts:90-105`). |
| Child-owned tool activity | Item lifecycle has optional `agentId` and `parentToolUseId` (`providerRuntime.ts:484-500`) | Web removes attributed item/tool chatter from the parent timeline (`apps/web/src/session-logic.ts:389-448`). |
| Attention | No task-attention event or reason schema | `waiting` means actual provider wait; thread shell separately carries `hasPendingApprovals`, `hasPendingUserInput`, and `backgroundLiveness` (`packages/contracts/src/orchestration.ts:791-848`). Do not encode die's advisory quiet/review checkpoint as waiting. |
| Approval | `request.opened/resolved` with envelope `requestId`; payload has canonical request type, detail/options/args and resolution/decision (`providerRuntime.ts:137-149,511-525,1049-1061`) | Commands are thread-scoped `thread.approval.respond` and `thread.user-input.respond/dismiss` (`orchestration.ts:1255-1290`). Request schema has no agent/task owner field. |
| Parent interruption | `thread.turn.interrupt`; adapter `interruptTurn(threadId, turnId?)` (`orchestration.ts:1255-1261`; `Services/ProviderAdapter.ts:91-103`) | Current web also calls it with no turn to stop all background work (`apps/web/src/components/ChatView.tsx:5980-6051`). No canonical per-task interrupt command exists. |
| Session exit | `session.exited`; client marks still-active agents interrupted but preserves idle (`subagentRuntime.ts:657-666`) | Background liveness is in-memory and cleared on session death; it intentionally does not survive server restart (`ThreadBackgroundLiveness.ts:1-14,64-71`). |

Ingestion persists generic `OrchestrationThreadActivity { id,tone,kind,summary,payload,turnId,sequence?,createdAt }` (`packages/contracts/src/orchestration.ts:573-591`). For task rows it copies linkage, stamps agent/background classification, bounds progress, and uses terminal summaries (`ProviderRuntimeIngestion.ts:366-409,596-698,701-796`). This is the clean reusable path; emitting ad-hoc frontend events would bypass retention, liveness, mobile, and tests.

### Classification is a semantic boundary

T3 classifies `monitor|monitor_mcp|local_bash|shell` as watch/background, `plan|dream` as inert, and other task types as agents. A non-agent task carrying `agentId` is agent-internal; a nested agent may also carry `agentId` and remains an agent (`providerRuntime.ts:589-624`). The server liveness registry applies the same rules and makes agents win over monitors for `working` vs `monitoring` (`ThreadBackgroundLiveness.ts:88-167`).

Therefore die **shell jobs are not child agents** even though both are managed by `TaskManager`. Emit `taskType: "shell"`, not a fabricated subagent. Emit die agents with an agent-flavored type such as `subagent` / `orchestrator`. This preserves the ordinary work log for shell/watch jobs and the Agents surface for actual model children.

## How current T3 adapters populate it (no fake equivalence)

| Aspect | Claude adapter | Codex adapter |
|---|---|---|
| Native child shape | SDK task messages inside one Claude session; no child T3/provider thread identity is claimed. | Multi-agent v2 children are full Codex app-server threads. Runtime registers them from `thread/started source.subAgent.thread_spawn` or `subAgentActivity` (`CodexSessionRuntime.ts:925-955,987-1016,1617-1674`). |
| Identity | `task_id`; remembers `tool_use_id, description, subagent_type, task_type, workflow_name, owningAgentId, model, effort` (`ClaudeAdapter.ts:267-287,3523-3595`). | Child `agentThreadId` becomes `RuntimeTaskId`; nickname/path leaf is title, role/path/model/effort linkage (`CodexAdapter.ts:1036-1080`). |
| Hierarchy | `parent_tool_use_id` resolves child-owned stream items to the spawning task; a nested task gets `agentId=owningAgentId` (`ClaudeAdapter.ts:1237-1281,2687-2695,2919-2933`). Workflow members use synthetic `coordinator:wf:index` ids and `parentAgentId` (`ClaudeAdapter.ts:3330-3394`). Generic nested-agent `parentAgentId` is not populated. | Spawn source yields `parentThreadId`; only `collabAgent/started` currently copies it to `parentAgentId` (`CodexAdapter.ts:1082-1097`). Later linkage omits it, so hierarchy can be lost if start retention expires. |
| Start/progress | SDK `task_started -> task.started`; `task_progress -> task.progress` with usage, last tool, workflow phases and synthesized members (`ClaudeAdapter.ts:3523-3632`). | Synthetic `collabAgent/started` or activity `started` -> `task.started`; child item/token events -> bounded `task.progress` summaries/typed usage (`CodexAdapter.ts:1082-1138,1209-1285`). |
| Status | SDK `task_updated`: completed/failed/killed/paused -> completed/failed/cancelled/idle (`ClaudeAdapter.ts:1227-1235,3634-3662`). | Child turn start -> running; turn complete -> idle, failed, or interrupted; status active plus waiting flags -> running/waiting; idle/systemError -> idle/failed (`CodexAdapter.ts:1140-1207`). |
| Completion | SDK `task_notification -> task.completed`, preserving summary/usage/output_file (`ClaudeAdapter.ts:3664-3687`). | A completed child turn is deliberately **idle, not completed**, because its thread is resumable. `closed` maps interrupted (`CodexAdapter.ts:1148-1167,1287-1293`). |
| Child chatter | Parent tool/item lifecycle gets `agentId`; Agents surface owns it. | Runtime intercepts known child notifications before parent mapping, emits synthetic `collabAgent/*`, drops only enumerated child chatter, and lets unknown/parent-owned approval correlation through (`CodexSessionRuntime.ts:1062-1125,1677-1685`). |
| Approval | Claude `canUseTool` callback emits `request.opened`, blocks on a deferred decision, and abort resolves cancel (`ClaudeAdapter.ts:4530-4585`). | Codex server requests map to `request.opened` and decisions to resolved (`CodexAdapter.ts:1360-1430`). Child approvals route through the parent-owned request path; they are not task-scoped. |
| Interrupt | Hard-stops the Claude session because SDK interrupt can leave background tasks alive (`ClaudeAdapter.ts:5086-5093`). | Delegates to app-server `turn/interrupt` (`CodexAdapter.ts:2559-2567`). Child status then comes from native child events. |

These are intentionally unequal. die is closer to neither wholesale: its agents are separate Pi session processes like child sessions, but its shell jobs and agents share one local manager and do not expose Codex's child-thread protocol.

## Existing frontend: reusable vs missing

| Surface / action | Already available | Missing for full die scope |
|---|---|---|
| Web Agents panel | Right-panel route already exists (`ChatView.tsx:8752-8759`); status/title/role/model/effort/elapsed/activity/result/error/tokens/tools/reactivation are folded into `RuntimeSubagent` (`subagentRuntime.ts:22-88`). Workflow phase groups and script viewer are implemented (`AgentsPanel.tsx:214-520`). | Rows are explicitly flat/non-interactive (`AgentsPanel.tsx:139-192`). No task detail, full output, transcript, input, per-task stop, snooze/watch, or resume action. |
| Parent timeline | Agent launches collapse to one live spawn row; expansion lists members and opens Agents panel (`MessagesTimeline.tsx:3812-3882`). Internal child chatter is suppressed/re-homed (`session-logic.ts:389-448`). | Generic nested hierarchy is not rendered. `parentAgentId` currently changes kind to `workflow_agent`, and panel grouping only recognizes parents of kind `workflow`; non-workflow children fall back to Direct spawns (`subagentRuntime.ts:258-271,318-336,744-763`). |
| Background status/stop | Thread shell has working/monitoring liveness; composer banner shows count and Stop, calling thread interrupt without a turn (`ChatView.tsx:5980-6059`). | Stop is all-background/session-level only. There is no canonical per-task command or stopping status. |
| Approvals/user input | Full pending request cards and response paths already exist through `ChatView.tsx:1483-1488,2760,7756-7860,9143-9200`. | No task attribution in canonical request schema. die currently has no generalized tool approval policy, so nothing honest can populate these for ordinary die tools. |
| Attention | Existing composer-banner infrastructure and thread wake UI can carry session-level notices. | No canonical task attention state/reasons/actions; Agents panel renders waiting as ordinary Working. die quiet/review, watch enabled, and snooze deadline need a small provider-neutral task-attention contract if browser actions are required. |
| Output | Agent row can show bounded `progress/result/error`; `outputFile` and `runHandles` survive the fold. Workflow script retrieval is a useful secure server-query pattern (`AgentsPanel.tsx:266-315`; `subagentRuntime.ts:357-395`). | No log pagination/viewer. T3 ingestion/client truncation means `task.progress/completed.summary` cannot carry die's full retained output. Do not overload it. |
| Mobile | Agent batches already collapse into expandable work-log cards with member status/detail (`apps/mobile/src/lib/threadActivity.ts:1083-1163`; `thread-work-log.tsx:1005-1085`). | No Agents sheet/panel and no task actions; current tests explicitly treat nested-agent completion as timeline-visible because mobile has no Agents sheet (`threadActivity.test.ts:3298-3314`). |

The least custom UI is therefore: reuse all current roster/timeline/liveness UI, then add one generic task-detail/action surface consumed by any provider. Reuse the workflow-script query's server-mediated access pattern and existing buttons/banners; do not build a die-only parallel Agents panel.

## die's actual task model and required mapping

### Current authoritative runtime

- `TaskManager` owns process-local tasks of kind `command|agent`; statuses are exactly `running|completed|failed|killed`. Summary includes timestamps, pid/exit/signal, byte offsets, timeout/termination, last activity, stdin-open, and optional agent metadata; inspection adds bounded output pagination/loss flags (`src/tasks/task-manager.ts:43-133`).
- Lightweight live events are `spawned|activity(output|input)|completed|stopping` (`task-manager.ts:70-76`). Spawn starts detached process groups, captures bounded merged stdout/stderr, and agent streams pass through `AgentProgress` (`task-manager.ts:158-219`). Close determines final status and extracts the final assistant answer separately from activity output (`task-manager.ts:220-260`). Stop records a stable cause, emits stopping, sends SIGTERM then SIGKILL (`task-manager.ts:409-428`).
- `AgentInfo` carries `type, model, thinking, depth, sessionFile, parentSessionFile` plus live phase/tool/error/event metadata (`src/tasks/agent-progress.ts:4-16`). The parser retains safe text/tool summaries and final assistant text but deliberately excludes reasoning/images/partial records (`agent-progress.ts:27-150`).
- Each subagent gets a real Pi session with `parentSession` and a durable `die-agent` custom entry containing its task id/metadata (`src/tasks/agent-session.ts:5-23`). `subagent` launches `die --session CHILD --mode json -p`; direct and batch launch, depth/delegation policy, model/thinking, timeout, and handoff are in `src/tasks/job-service.ts:153-237`.
- Public task actions already exist: paged list/inspect, stdin input/close, stop, snooze, watch toggle (`job-service.ts:239-285`; bridge declarations `src/typescript/job-bridge.ts:108-155`).
- Attention is `quiet|review`, default 5/10 minutes. It is evidence-only, jobs keep running, completion removes scheduler state, and snooze/watch are policy controls (`src/tasks/job-attention.ts:4-35,60-131,174-209,241-309,357-404`).
- Per-session `.jobs.jsonl` is a protected, bounded **ownership index only** and explicitly excludes commands/prompts/output (`src/tasks/task-lifecycle.ts:14-35,88-156`). Current records omit activity and contain event/status/times/termination/exit/signal/child session path (`src/tasks/extension.ts:311-368`). It is recovery evidence, not the live transport.

### Concrete normalization table

| die fact | T3 emission |
|---|---|
| Root T3 thread ↔ root die Pi session | Keep in the die adapter's session directory. All descendant task events retain the root T3 `threadId`; do not create user-visible T3 threads for shell jobs or each child session. |
| Opaque task identity | Namespace by die root/session identity plus die task id. Raw `task_xxxxxxxx` is only manager-local and is insufficient as a cross-process canonical key. |
| Agent spawn | `task.started`, `taskType=subagent|orchestrator`, title from a safe explicit label (not full prompt), role from profile type, model, effort/thinking, child session handle. |
| Shell spawn | `task.started`, `taskType=shell`. It remains ordinary/background work. Never synthesize an agent child. |
| Nested task | Emit both `agentId=<owning agent>` for internal-work semantics and, for an actual nested agent, `parentAgentId=<owning agent>`. This requires the T3 generic-tree fix noted above; omitting one loses either classification or hierarchy. |
| Output/input activity | Throttle/coalesce to `task.progress` or `tool.progress` previews with status running, last tool/phase, and latest safe text. Keep full bytes behind inspect pagination. Never send every output chunk as a persisted activity. |
| Agent phase | waiting-for-model/receiving/running-tool remain running summaries; “waiting for background work” is running unless actually blocked on user/approval. No die phase currently means Codex-style resumable idle. |
| Attention checkpoint | Keep status running; publish explicit attention metadata in the proposed task-attention extension and a thread wake/banner. Never map quiet to waiting or failed. |
| Stop requested | Keep running with a “stopping” progress/detail until process close (canonical status has no stopping). On observed killed close emit `task.completed status=stopped`; timeout can additionally carry error/detail and die termination cause. |
| Normal close | completed -> `task.completed completed`; nonzero/parser failure -> failed; final assistant answer -> bounded summary plus full inspect/transcript handle. |
| Root session/process exit | `session.exited`; T3 already interrupts still-active agents and clears liveness. Do not fabricate individual successful completions. |
| Die completion wake | Emit task terminal state for UI, but preserve die's own completion custom message/model continuation ownership. Do not send another synthetic follow-up; earlier backend research documents the duplicate-continuation risk. |

## The decisive missing die seam

Current direct children are observable to their parent's `TaskManager`, but a spawned orchestrator creates its own manager in another process. The root has only that agent process's filtered JSON progress; nested task managers, attention state, and controls are not root-addressable. Session lineage files permit after-the-fact discovery, but polling all `.jobs.jsonl` files would still lack activity/output and cannot route input/snooze/watch to a live nested manager.

The full solution therefore needs die to expose a versioned root-scoped task service, ideally over the existing RPC session process:

1. Snapshot: tasks with opaque globally unique id, kind, parent task id, child session id (opaque, not browser path), metadata, status/termination, offsets/activity, attention policy/state.
2. Ordered events: spawned, activity/coalesced progress, stopping, attention, completed, and root/child session unavailable; each event has monotonic sequence and root session id for reconnect replay/resync.
3. Routed commands: inspect(offset,limit), input/close, stop, snooze, setWatch, plus stop-all. Commands return observed state and are idempotent where practical.
4. Recursive registration: child die processes report their manager to the root broker or receive a routable control channel. The browser/T3 adapter must not discover/control children by arbitrary filesystem path.
5. Durable boundary: `.jobs.jsonl` remains metadata recovery evidence; live tasks remain process-owned. On reconnect snapshot + sequence closes gaps; after backend/process restart, mark formerly running tasks interrupted/unavailable rather than claiming resume.

This is a die change, not a T3 UI invention. Once exposed, the T3 die adapter performs the small normalization table above and all existing ingestion/client paths work.

## Clean T3 change boundaries

1. **Driver/package boundary:** implement `Drivers/DieDriver.ts` and a per-instance adapter/runtime. The SPI requires isolated per-instance state and scoped cleanup (`apps/server/src/provider/ProviderDriver.ts:58-89,121-171`). Register it only in `provider/builtInDrivers.ts:11-19,36-56`.
2. **Adapter boundary:** satisfy `ProviderAdapterShape` (session start/send/interrupt/request response/stop/read/rollback/events) and emit only canonical `ProviderRuntimeEvent` (`Services/ProviderAdapter.ts:67-158`). Keep Pi/die RPC parsing, task snapshot/event sequencing, and process supervision inside die-specific runtime files.
3. **Contracts/config:** `ProviderDriverKind` is already an open validated slug, so do not expand a provider enum (`packages/contracts/src/providerInstance.ts:40-75`). Add a browser-safe `DieSettings` schema and provider client metadata; current client definitions are intentionally the future provider-package boundary (`apps/web/src/components/settings/providerDriverMeta.ts:21-46,46-104`).
4. **Generic task projection:** reuse `ProviderRuntimeIngestion`, `ThreadBackgroundLiveness`, `foldSubagentActivities`, timeline spawn rows, Agents panel, and mobile work log unchanged for flat status. T3 changes should be limited to (a) a true generic parent/child tree rather than treating every `parentAgentId` as workflow membership, and (b) generic task detail/actions/attention contracts if product scope requires them.
5. **No provider leakage:** do not add `if provider === die` to AgentsPanel/ChatView. Adapter capabilities should advertise inspect/input/stop/attention support; generic UI invokes generic orchestration commands. Claude/Codex can leave unsupported capabilities absent.
6. **Security:** session/transcript paths stay server-side. Follow the existing workflow script query pattern rather than exposing arbitrary file reads. Commands route by environment + T3 thread + opaque task id and verify task ownership.

## Acceptance boundary

A full agent/task integration is honest when:

- Direct and nested die agents have stable hierarchy and session linkage; shell jobs remain background tasks.
- Spawn/progress/attention/interruption/completion survive reconnect via snapshot + ordered events; dead processes become interrupted, not perpetually working.
- Web reuses Agents/timeline/liveness; mobile at least retains its existing spawn cards. Full output and actions use a generic task detail surface.
- Inspect pagination preserves `baseOffset/outputEnd/nextOffset/outputLost/hasMore`; final answer is not confused with merged diagnostic output.
- Parent stop kills root turn plus all live descendant tasks; per-task controls route to the correct owning process.
- die attention remains advisory-running and exposes real quiet/review/watch/snooze semantics.
- T3 approvals appear only after die implements a real policy/gate. Until then the die adapter emits no fake `request.opened` and its request responder is an unsupported/no-pending operation.
- No claim is made that die shell jobs are Codex child threads, that die agents are Claude SDK tasks, or that active tasks can resume after owner process restart.
