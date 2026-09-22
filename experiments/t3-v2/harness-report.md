# T3 v2 upstream integration harness report

## Verdict

PASS against upstream `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`.

The harness uses the upstream orchestration-v2 stack rather than a local model of it: `OrchestratorV2`, MCP toolkit/service, event/projection persistence, command receipts, provider runtime, and continuation/delivery paths. The only mocked boundary is provider execution, via upstream deterministic Codex and Claude adapter doubles. No credentials, external services, or listening ports are required.

## Covered behavior

- `delegate_task` creates a durable app-owned subagent, child thread, child run, spawn transfer, and parent/child graph.
- `task_status` returns the terminal child result and stable result context-transfer identity.
- Rebuilding the authenticated MCP invocation scope (same durable provider session identity, new object/issue time) can recover status after reconnect.
- Replaying `delegate_task` after reconnect with the same `clientRequestId` returns the same task/result transfer, starts no extra provider turn, and leaves exactly one parent subagent row.
- Child follow-up status remains associated with the delegated task without replacing the original delegated result.
- `task_cancel` interrupts a running child; later status is `interrupted`, automatic parent delivery is disposed, and no continuation wake is emitted.
- The broader focused upstream scenario also exercises completion acknowledgement and delivery race handling around the same real services.

## Reproduction

`experiments/t3-v2/setup.sh`, then:

`experiments/t3-v2/run.sh test-ui apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts -t "delegates cross-provider tasks with exactly-once reconnect, status, results, graph, and cancel"`

The setup script materializes a clean checkout at the exact pin under `experiments/t3-v2/.runtime/upstream`, applies `upstream.patch`, and installs locked dependencies into isolated experiment paths. The run script confines HOME/XDG/T3 state and logs to `.runtime`; the command above selects one named integration scenario.

Focused command:

`pnpm vp test run apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts -t "delegates cross-provider tasks with exactly-once reconnect, status, results, graph, and cancel"`

Observed results (direct focused command, then the checked-in runner):

- both runs: 1 test file passed; 1 test passed and 1 skipped by name filter
- direct run: test body 7.00 s; total 12.79 s
- repeated direct run: test body 10.11 s; total 18.20 s
- isolated `.runtime/upstream` run: test body 7.45 s; total 15.54 s

## Limits

This is deterministic service-level integration, not a browser/network end-to-end test. Reconnect is modeled by discarding and reconstructing the authenticated MCP invocation scope while retaining only its durable session identity. Provider execution is explicitly mocked; orchestration, persistence/projection, delivery, cancellation, and MCP tool implementations are upstream real code.
