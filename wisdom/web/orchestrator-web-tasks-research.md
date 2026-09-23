# Orchestrator subagents as web GUI tasks research (pending)

Started 2026-09-20T16:00:53.452Z.
User wants mode=orchestrator in die to spawn subagents/threads as separate tasks visible in web GUI; asked to spin off subagents for deep codebase research.

Launched research jobs:
- task_8dd62297: project subagent/orchestrator task launching hooks
- task_ae505dd1: web GUI/backend task/session model
- task_30a483b2: upstream Pi packages/orchestrator v2/task support

Preliminary local findings:
- Die already has custom async task extension loaded in src/cli.ts via src/tasks/extension.ts.
- subagent tool implemented in src/tasks/job-service.ts.
  Gate: canDelegate(depth,parentType), only orchestrator agents can delegate.
  It spawns process.execPath with --session prepared.agent.sessionFile --mode json -p --model ... -- prompt.
  Task kind='agent', displayCommand 'die agent [type]: ...'.
- Task lifecycle managed by src/tasks/task-manager.ts and emits TaskEvent spawned/completed.
- src/tasks/web-events.ts formats lifecycle-only NDJSON records {type:'die_task_event', event:'started|completed', task:{id,kind,status,command,agent?}} when mode==='rpc' and DIE_WEB_TASK_EVENTS=1.
- src/web/launcher.ts sets DIE_WEB_TASK_EVENTS=1 for web backend launch.
- web/t3.patch contains T3 Pi adapter changes decoding die_task_event into Runtime task.started/task.completed (handleDieTaskEvent around patch line ~6593), maintaining ctx.dieTasksById, taskType subagent/shell.
  It ties new die tasks to currentTurn; if no currentTurn, it ignores starts.
  Stop can close session to stop die tasks when no active turn but running die tasks exist.

Likely direction:
- Minimal implementation may already be mostly present for die-owned subagent() tool calls in orchestrator mode.
  Verify through web smoke using orchestrator mode and subagent call.
- If user means "threads as separate tasks" in T3 task list, ensure die_task_event reaches web adapter for child subagents spawned from orchestrator in RPC mode and events include enough metadata/title.
- Biggest risk: child subagent sessions are separate Pi sessions/files, but web UI task projection is lifecycle-only; no separate chat thread is selectable unless we add thread/session registration.

Next: inspect research job outputs when done; run targeted smoke/tests; decide if need code changes to show spawned agents as web tasks or as full T3 threads.


## Research completed 2026-09-20T16:05:36.260Z

All three research agents completed. Consolidated conclusions:

- Existing die subagent implementation already spawns real separate child die/Pi sessions/processes and registers them with TaskManager as kind=agent.
  Key files: src/tasks/job-service.ts, src/tasks/agent-session.ts, src/tasks/task-manager.ts, src/tasks/agent-progress.ts.
- Orchestrator mode: SUBAGENT_TYPES includes fast/normal/orchestrator; canDelegate allows root or orchestrator child; nested orchestrators cannot spawn another orchestrator.
  Root /mode and main orchestrator prompt are in src/tasks/instruction-mode.ts and src/prompts/main-orchestrator.md.
- Web bridge: src/tasks/web-events.ts emits lifecycle-only die_task_event for spawned/completed when mode=rpc and DIE_WEB_TASK_EVENTS=1. src/web/launcher.ts sets it.
- Patched T3 PiAdapter consumes die_task_event and emits Runtime task.started/task.completed with taskType subagent/shell and IDs pi-die:<external task id>; rendered through existing Agents/task UI.
  Current projection is task attached to parent turn, not a distinct sidebar thread.
- No upstream "orchestrator v2" or first-class task/thread API exists in pi-coding-agent/server/protocol/tui.
  Reusable upstream primitive is pi-agent-core AgentHarness/AgentLane if building a new durable orchestrator, but for this project the smallest/best path is to extend existing TaskManager->die_task_event->PiAdapter bridge.

Recommended implementation path:
1.
  First make current lifecycle task cards robust: include child public session id (not raw file path), parentTaskId/parentThreadId, timestamps/status/title in WebTaskEventRecord; update PiAdapter.handleDieTaskEvent to map into RuntimeTask metadata (agentId/parentAgentId/runHandles if useful).
  Add tests in tests/web-task-events.test.ts and patched PiAdapter tests.
2. Add reconnect snapshot: on RPC/session startup, emit/list bounded currently running TaskManager tasks so web UI does not miss starts.
3. Add per-task stop: map GUI task id pi-die:<task_*> to jobs.stop rather than closing owning session.
4.
  Only if user means separate selectable sidebar chat threads: create/import an OrchestrationThread per child persisted session, ingest child session events separately, define parent/child linkage and ownership semantics, and prevent duplicate AgentSessionScanner/Importer registrations.
  This is larger and riskier.

Risks:
- die_task_event starts are dropped if no active parent turn. Transport only start/end and in-memory maps, so restart/reconnect can lose live task state.
- Raw session paths should not be exposed in web API. Use generated stable public child session IDs/handles.
- Parent completion vs child completion/cancellation semantics need explicit definition.


## Deeper T3 orchestrator-v2/collab-agent finding 2026-09-20T16:11:57.595Z

User pushed to look deeper: there IS relevant "orchestrator-v2-shaped" code in T3, but it is not a reusable exported orchestration engine for Die.
Important files in generated T3 checkout .cache/die-t3code:

- packages/client-runtime/src/state/subagentRuntime.ts lines 1-11: fold over task.* activities into orchestration-v2-shaped subagent state. deriveAgentPanelModel has v2Projection param but ChatView passes none.
  Lines 2748-2757 in apps/web/src/components/ChatView.tsx confirm v2Projection is null until orchestration-v2 lands.
- apps/server/src/provider/Layers/CodexSessionRuntime.ts lines 925-941: native collab child-agent tracking (multi-agent v2).
  Under v2 subagents are full app-server threads; identity arrives on thread/started source.subAgent.thread_spawn, lifecycle on subAgentActivity and child thread notifications.
  It intercepts child notifications and emits synthetic collabAgent/* provider events.
- CodexSessionRuntime registration paths: thread/started + source.subAgent.thread_spawn (1550-1609), parent subAgentActivity (1612-1675), child turn/status/token/item/closed rerouting to collabAgent/* (1718-1856), stop interrupts live child turns first (2480+).
- apps/server/src/provider/Layers/CodexAdapter.ts lines 1036-1043 maps synthetic collabAgent/* events into shared task.* lifecycle with RuntimeTaskId = agentThreadId, timelineBypass true; started includes parentAgentId from parentThreadId, status/progress/token/item updates are task.updated/progress.
- packages/contracts/src/providerRuntime.ts TaskAgentLinkage fields include taskType, agentKind, agentId, parentAgentId, runHandles, agentPath, timelineBypass. classifyTaskAgentKind treats unknown/subagent/local_agent/local_workflow as agents unless monitor/plan/dream or internal background.

Implication for Die: Better bridge is not just old lifecycle task cards; emit Die subagents in the same shape T3's multi-agent-v2 fold expects.
For Die subagent starts, use task.started payload with taskType likely local_agent or subagent, taskId stable public child session/thread id or pi-die:<task>, title/role/model/effort, parentAgentId for hierarchy, runHandles/session handle if available, timelineBypass true.
Emit task.updated/progress for activity, task.completed/updated for terminal/idle.
If we can surface child sessions as app-server threads, mimic Codex v2 source.subAgent.thread_spawn/collabAgent path, but for minimal integration, task.* with these linkage fields feeds AgentsPanel today.


## Research reopened — 2026-09-20T16:19:08.018Z
User requests deeper investigation before better judgments.
Previous conclusions premature; importantly T3 orchestration-v2 (#4779) and Codex multi-agent v2 are DIFFERENT, not interchangeable.
Avoid asserting no upstream API based solely on pinned cache absence/comments.
Four new read-only research agents running:
- task_9344509a: actual upstream PR #4779/branches/history/source/status vs pinned 719a76ca; report wisdom/t3/t3-v2-upstream-research.md
- task_b9764f5b: full current thread execution/control flow and ownership; report wisdom/t3/t3-thread-execution-research.md
- task_3b602c72: GUI/projections/subscriptions and actual v2 seam; report wisdom/t3/t3-task-ui-research.md
- task_0901b73b: independent integration option comparison grounded in Die ownership/IPC; report wisdom/t3/die-t3-thread-options-research.md
No product changes authorized or made.
On completion read reports, reconcile disagreement with sources, compare full thread solutions not just status cards.
Need consolidate evidence-backed recommendation and uncertainties; don't settle architecture before reports.

First deeper report completed: wisdom/t3/die-t3-thread-options-research.md (task_0901b73b).
Read executive summary and staged options.
Concrete finding: children run --mode json -p with stdin closed; do not imply selectable child thread automatically supports steer.
Report compares task cards vs read-only child-thread projection with Die ownership vs backend-owned delegation.
Recommendation is provisional until upstream v2 and other reports reconciled.
Report references .cache/die-t3code-v0042 while previous inspection used .cache/die-t3code; verify checkout revision equivalence before trusting line references.
No implementation decisions yet.

## Major corrections from deeper research 2026-09-20T16:36:21.718Z
- Upstream report finished wisdom/t3/t3-v2-upstream-research.md.
  T3 v2 REAL implemented on open PR #2829 t3code/codex-turn-mapping, researched immutable head a9b49a7df0a4261dcc438d4493cc3154a1d9819e.
  PR #4779 is historical unmerged stacked observability slice; merged #5219 is main/v1 observability bridge.
  Earlier 'no API' conclusion WRONG beyond current pin.
- Personally read upstream docs/orchestration-v2/orchestrator-mcp-server.md in .agents/research-t3-v2-pr2829: session-scoped authenticated MCP delegate_task creates child T3 thread/run, async/wait result delivery, task_status/task_cancel; create_threads for ordinary top-level threads; ThreadManagementService shared application boundary, ThreadLaunchService higher-level launch/workspace setup.
  V2 not in pinned main; adopting requires branch repin/large port, not one hook.
  Need compare feasibility, not blindly minimal cards.
- Backend report wisdom/t3/t3-thread-execution-research.md proves .cache/die-t3code STALE (6f00d388); actual pin+patch verified in .cache/die-t3code-v0042 (719a76ca...).
  Prior generated-cache citations unreliable without checking.
  No tests run, source/tests inspected.
- Critical ownership rule: never resume/start child session in T3 while Die process writes it.
  Pi adapter leases don't cover external Die children.
  Option read-only projection vs backend-owned independent execution still to reconcile with v2 upstream feature and GUI report pending task_3b602c72.
