# Execute bridge followthrough

Active bridge-client.ts now sends mcp-protocol-version on POST/DELETE (required by the real Effect MCP server), checks JSON-RPC response IDs, skips unrelated SSE notifications/results, and exposes close(). One-shot delegateTask/taskStatus/taskCancel helpers DELETE their transport session on success or error. A cleanup error cannot mask the original task error. The mock-fixture extension now reuses this transport instead of maintaining a divergent client; actual PiAdapterV2 continues loading its upstream-generated extension and approval hooks.

A strict mock protocol regression verifies post-init header/session checks, ignored unrelated SSE frames, repeated one-shot status preserving task identity, and session deletion on rejection. This is **not** real-server conformance acceptance; the separate integrated harness must exercise the real server.

Actual Die RPC tests now cover a scripted rejected delegate_task. The error reaches the next deterministic model request, there is one attempted tool call and no automatic HTTP retry; the successful path still delivers the result. Both paths also execute typeof subagent and observe **function**. Thus the general local helper remains available despite bridge guidance. This prototype does **not** prevent a model from deliberately launching a duplicate local agent. No policy enforcement or arbitrary-script zero-spawn guarantee is claimed.

Launcher argument normalization recognizes --extension/-e split and equals forms and avoids appending activation twice while preserving upstream injection. Five focused argument tests pass.

Rerun: bun test experiments/t3-v2/bridge.test.ts experiments/t3-v2/bridge-client.test.ts experiments/t3-v2/bridge-launch-args.test.ts

No private credentials read/changed; synthetic auth values are not emitted in evidence. Production binary/pin/patch remain unchanged.
