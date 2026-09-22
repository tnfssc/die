# T3/Die child-thread research synthesis (2026-09-20)

All four deeper reports complete: t3-v2-upstream-research.md, t3-thread-execution-research.md, t3-task-ui-research.md, die-t3-thread-options-research.md. No product code changed. Source inspection, not a demonstrated runtime integration.

Corrections: .cache/die-t3code is stale 6f00d388; .cache/die-t3code-v0042 matches pin 719a76ca + web/t3.patch (backend worker verified reverse patch). T3 orchestration-v2 is real and distinct from Codex multi-agent v2. Implemented on unmerged PR #2829, research head a9b49a7d; #4779 historical observability stack, #5219 merged v1 observability bridge. Current pin has no v2 runtime/API.

Real v2 supplies session-scoped MCP delegate_task/task_status/task_cancel, T3-owned child threads/runs and result delivery. create_threads/top-level launch is distinct. Adopting branch is broad migration; do not cherry-pick task tool in isolation.

Lead directly verified upstream source in .agents/research-t3-v2-pr2829:
- docs/orchestration-v2/orchestrator-mcp-server.md: purpose, ownership, credentials.
- apps/web/src/components/chat/V2ItemInspector.tsx:210: Open subagent thread button navigates via childThreadId.
- apps/web/src/components/Sidebar.logic.ts:493-508: v2 hides subagent lineage from ordinary sidebar list.
- apps/web/src/components/chat/ThreadRelationshipsControl.tsx:173+: projection subagent childThreadIds mapped for relationship panel. Thus real navigable child threads, not automatic ordinary sidebar rows.
- apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts exists and explicitly supports T3 MCP delegation, materializes extension, launches configurable Pi binary via RPC.
- piT3McpExtensionSource.ts: registers discovered MCP tools as mcp__t3-code__<name>.
- Die src/tasks/extension.ts:559 sets active tools to execute only. Crucial integration uncertainty: extension injection/tool visibility/execute bridge may conflict; cannot say just pointing binary to die works. Need probe bridge or activation sequencing.

Recommendation: isolated pinned-v2 feasibility spike, NOT switching shipped backend yet. Prove die RPC loads v2 Pi adapter, exposes delegation through execute coherently, T3 creates child once (no duplicate local spawn), UI can open transcript, parent receives result, cancellation and reconnect sane. Preserve ownership single-writer invariant. If ordinary sidebar visibility required, that's a separate UI choice from native v2 subagent navigation.

Remaining work: user chooses whether to proceed to spike; no integration tests/build run; branch churn/migration/patch rebase costs unmeasured. Earlier read-only projection recommendation provisional and superseded as preferred research next step by evaluating existing v2 service.
