# Die execute → T3 delegation bridge

## Completed design

The experiment bridge now keeps **execute as the only model-visible tool**. PiAdapterV2 may still inject its generated T3 MCP extension; the launcher preserves that argument so upstream approval and lifecycle hooks remain loaded, while `bridge-activation.ts` resets visibility to execute immediately before each model request.

The extension appends an absolute, experiment-scoped import instruction. Execute programs use:

```ts
import { delegateTask } from "/absolute/path/to/experiments/t3-v2/bridge-client.ts";
const result = await delegateTask({ task: "...", mode: "async" });
```

`bridge-client.ts` reads the session-scoped `T3_MCP_URL` and `T3_MCP_BEARER_TOKEN` inherited by Die's execute subprocess, initializes Streamable HTTP MCP, and calls `tools/call` with `name: "delegate_task"`. It contains no local `subagent()` path. Credentials remain in headers and are not printed or placed in argv.

## Files

- `bridge-client.ts` — execute-importable T3 client and exported `delegateTask` API.
- `bridge-launcher.ts` — transparent provider launcher; retains incoming PiAdapterV2 extension and appends bridge guidance/policy.
- `bridge-activation.ts` — keeps only execute active and supplies the absolute import guidance.
- `bridge-extension.ts` — isolated stand-in for upstream's injected extension in the loopback proof; not added by the launcher.
- `bridge.test.ts` — deterministic explicit mock T3 MCP + mock model + actual built Die RPC process.

## Deterministic evidence

`bun test experiments/t3-v2/bridge.test.ts`

Result: **1 pass, 0 fail, 9 assertions**. The model-visible tool list is exactly `["execute"]`. The mock model issues a real Die execute tool call whose TypeScript imports the absolute bridge client. The execute subprocess inherits the endpoint/token, invokes `delegate_task` exactly once with the expected arguments, and its returned `T3_DELEGATE_RESULT` appears in the next provider request. The bearer token is accepted by every MCP request and absent from captured RPC output.

Focused TypeScript checking of all bridge files also passes.

## Superseded alternative / limitations

The earlier activation-only approach exposed `mcp__t3-code__*` beside execute. That was only partial: delegation was not accessible *from execute*, so it did **not** complete this requirement and is no longer the active design.

This proof uses an explicitly named mock T3 MCP server and deterministic model, not a paid model or full browser lifecycle. PiAdapterV2 still owns production endpoint/token injection and its generated approval hooks. Duplicate local delegation is excluded by the bridge architecture and explicit guidance, not by removing the general-purpose `subagent()` helper from execute globally.

## Coordinator integration review

Added execute-importable taskStatus(taskId) and taskCancel(taskId), guidance for stable clientRequestId replay, no-op extension activation outside T3, and redirect rejection to avoid forwarding bearer credentials. Three additional focused mock transport/activation tests pass (6 assertions): fresh-client status/cancel, unauthorized rejection, redirects rejected, ordinary non-T3 activation inert. Actual Die execute delegation test rerun PASS. These client tests do not imply real upstream network cancellation/reconnect; the real upstream service-level harness covers those lifecycle semantics separately.
