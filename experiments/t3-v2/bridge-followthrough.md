# Execute bridge followthrough

Active bridge-client.ts sends mcp-protocol-version on POST/DELETE (required by the real Effect MCP server), checks JSON-RPC response IDs, skips unrelated SSE notifications/results, and exposes close(). One-shot delegateTask/taskStatus/taskCancel helpers DELETE their transport session on success or error. A cleanup error cannot mask the original task error. The mock-fixture extension now reuses this transport instead of keeping a separate client. Actual PiAdapterV2 continues loading its upstream-generated extension and approval hooks.

A strict mock protocol regression checks post-init header/session checks, ignored unrelated SSE frames, repeated one-shot status preserving task identity, and session deletion on rejection. This is **not** real-server conformance acceptance. The separate integrated harness must exercise the real server.

Actual Die RPC tests cover a scripted rejected delegate_task. The error reaches the next deterministic model request, there is one attempted tool call and no automatic HTTP retry. The successful path still delivers the result. Both paths also execute typeof subagent and observe **function**. The general local helper is still available despite bridge guidance. This prototype does **not** stop a model that deliberately launches a duplicate local agent. It does not claim policy enforcement or zero spawns from arbitrary scripts.

Launcher argument normalization handles --extension/-e split and equals forms and avoids appending activation twice while preserving upstream injection. Five focused argument tests pass.

Rerun: bun test experiments/t3-v2/bridge.test.ts experiments/t3-v2/bridge-client.test.ts experiments/t3-v2/bridge-launch-args.test.ts

No private credentials read/changed. Synthetic auth values are not emitted in evidence. Production binary/pin/patch remain unchanged.
