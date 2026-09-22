# T3-v2 experiment acceptance review

Scope: isolated experiment gates for **Die orchestrator → execute → exactly one T3-owned delegated child**. Use unique markers and instrumented fakes; do not infer success from final prose alone.

## P0 — feasibility gates

### 1. Single-owner launch; fail closed
- Start one parent Pi/Die turn and invoke one execute delegation with a unique clientRequestId and marker. Assert exactly one V2 delegated_task.request, one parent subagents row, one childThreadId, and one child run. Replay the same request ID: IDs stay identical and no second child appears.
- Spy on T3 ChildProcessSpawner and Die TaskManager/process launch. The T3-owned Pi provider process is allowed; there must be no Die local subagent process, DIE_SUBAGENT_DEPTH child, or Die background-job row for the delegation.
- Repeat with missing/expired MCP credentials, unreachable MCP endpoint, and authorization failure. Each must report an explicit failure and create zero children, never fall through locally.
- Hazard: Die currently routes subagent to manager.spawn and DIE_SUBAGENT_* in src/tasks/job-service.ts; src/typescript/execution.ts and src/typescript/job-bridge.ts forward those methods. Upstream only warns and returns when T3_MCP_URL/token is absent (.agents/research-t3-v2-pr2829/apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:249-258). Silent fallback violates single ownership.

### 2. Tool activation and one routing surface
- On first turn, resume, and extension reload, inspect registered and active Pi tools. execute must remain callable and its delegation API must reach T3. Assert only one effective route: no duplicate caused by both execute bridging and direct mcp__t3-code__delegate_task exposure.
- Negative probe: request delegation while the T3 bridge is disabled. It must say unavailable, not invoke local subagent or claim success.
- Confirmed mismatch requiring a deliberate resolution: Die resets active tools to [execute] on every session_start (src/tasks/extension.ts:552-560), while upstream dynamically registers mcp__t3-code__* and instructs Pi to use those names (.agents/research-t3-v2-pr2829/apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:261-297,306-326). Registration/get_commands alone is insufficient; test what the model can actually call after all handlers run.

### 3. Scoped authorization
- For parent A, assert injected URL/token gives an invocation scoped to A's threadId, current providerSessionId, and provider instance. Use A's token on B/task B: reject with no mutation. Rotate/revoke A: old token gets HTTP 401; replacement succeeds once.
- Resume A and verify the adapter uses the current thread credential, not inherited process environment. Repeat for a nested child and require its own child-thread credential.
- Sources: apps/server/src/mcp/McpHttpServer.ts:63-121; McpInvocationContext.ts; orchestration-v2/ProviderSessionManager.ts:430-459; Adapters/PiAdapterV2.ts:399-405; Adapters/piT3McpInjection.ts:280-305.

### 4. Open the durable child transcript
- Child emits two distinctive messages/tool events. Open it from the parent subagent item and relationships control. Assert navigation targets the exact childThreadId and both events remain in that child's V2 projection after refresh/reconnect.
- Do not require a normal sidebar row: upstream filters subagent lineage (apps/web/src/components/Sidebar.logic.ts:493-508). Native entry points are chat/V2ItemInspector.tsx:210-212 and chat/ThreadRelationshipsControl.tsx:173-182,230-252.

### 5. Result delivered exactly once across both ACK systems
- Complete with a unique marker. Assert one parent completion wake/message, one stable published summary, and one subagent_result transfer. Repeated task_status, refresh, and a later child follow-up cannot duplicate or replace the published result; latestTerminal* may advance separately.
- Disconnect at: (a) before child terminal, (b) after terminal persistence/before wake, (c) after response bytes/before worker ACK, and (d) after ACK. Reconnect: marker appears once and delivery reaches one terminal delivery state.
- Hazard: T3 acknowledges terminal observation during task reads (apps/server/src/mcp/OrchestratorMcpService.ts:1007-1050) and repairs pending/claimed/delivered/acknowledged delivery (orchestration-v2/DelegatedCompletionDelivery.test.ts). Die separately keeps bridge ACK provisional until clean worker completion and restores notification ownership on disconnect (src/typescript/execution.ts:200-204; src/tasks/task-manager.ts:356-394). Prove the layers do not each deliver once.

## P1 — lifecycle and composition

### 6. Stop and reconnect
- Stop a running child through the intended Die control. Assert one V2 run.interrupt, terminal cancelled/interrupted state, no later provider activity, idempotent second stop, and no local PID kill presented as success.
- Disconnect parent while child runs, reconnect, and query the same task ID. Let it finish: no replacement child/run and one completion. Stop the parent Pi turn too; record and assert the chosen child policy (continue or cancel), rather than accepting accidental process teardown.
- Cancel while waiting_for_children. Upstream says task_cancel only interrupts a current active run and cannot interrupt native background work between turns (docs/orchestration-v2/orchestrator-mcp-server.md, task_cancel). Pi user Stop intentionally tears down its RPC process (Adapters/PiAdapterV2.ts:483-490); ensure durable work is neither orphaned nor duplicated.

### 7. Nested closure
- C1 delegates C2 through T3. Assert parent→C1→C2 lineage, distinct scoped credentials, navigable transcripts, and zero Die-local grandchildren.
- Finish C1's own turn before C2. C1 reports waiting_for_children and the parent's C1 task remains nonterminal. Finish C2; C1 then publishes once and the parent receives C1 once. This matches the wait contract including nested work/follow-ups in docs/orchestration-v2/orchestrator-mcp-server.md.
- Attempt task_status/task_cancel on a sibling parent's task ID and require rejection. Parent projection scoping is in apps/server/src/mcp/OrchestratorMcpService.ts:940-1050,1394-1435.

## Required evidence

For every scenario capture parent/child thread and run IDs, client request ID, projection/delivery states, process-spawn log, active-tool list, auth response, navigation target, and unique-marker count. A green final answer without these observables is not acceptance evidence.
