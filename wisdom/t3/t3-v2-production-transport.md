# T3 v2 production transport follow-up

Date: 2026-09-21

## Scope and disposition

Follow-up ownership was limited to `src/tasks/t3-mcp-client.ts` and `tests/t3-production-bridge.test.ts`. Production delegation remains intentionally fail-closed in `JobService`. This work does not add a remote-job adapter or change web/root routing.

The staged MCP client is now a bounded, session-owning transport rather than an unsafe “safe-stage” placeholder:

- `close()` stops admission first, aborts the client-owned controller, waits (with a bound) for admitted requests to settle, captures a session acquired by concurrent initialization, and only then sends session `DELETE`. Calls cannot report success after close.
- Request timeout controllers, caller/owner abort listeners, response readers, timers, and reader locks have explicit ownership and cleanup.
- JSON and SSE responses share a cumulative 1 MB budget. SSE is parsed incrementally across chunk/frame boundaries and returns/cancels as soon as the matching result arrives; remote EOF is not required.
- Server RPC/tool error details and response bodies are never reflected into local errors. Transport errors are normalized so bearer values and remote payloads are not exposed.
- Environment and direct-constructor endpoints reject userinfo, non-HTTP(S) schemes, and query/fragment components. Redirects remain disabled.
- Tool calls are restricted to `delegate_task`, `task_status`, and `task_cancel`. `delegate_task` needs a caller-supplied, nonblank clientRequestId of at most 128 characters. The client does not generate or mutate it.
- Session reconnect is one-shot on 404 only for the allowlisted operations. The previous blanket 400 retry was removed. Concurrent expired-session requests share reinitialization and preserve their original arguments/key.
- RPC envelopes, response IDs, session IDs, tool-result shape, and direct client configuration receive runtime validation.

## Verification

Focused suite: `bun test tests/t3-production-bridge.test.ts` — **14 pass, 0 fail, 47 assertions**.

Added coverage includes:

- close during initialize after session acquisition and close during a stalled tool body;
- no post-close admission/success and DELETE ordering after body cancellation;
- matching, chunk-split, endless SSE completing without EOF and cancellation reaching the stream;
- oversized body rejection;
- reflected secret RPC errors and HTTP body redaction;
- endpoint query/fragment rejection;
- tool allowlist, missing/blank/oversized delegate request IDs, malformed envelopes, and response-ID mismatch;
- no retry on HTTP 400 mutation;
- simultaneous requests sharing exactly one reconnect;
- 20 repeated initialize/call/close cycles with one server-session DELETE per cycle.

TypeScript verification: `bunx tsc --noEmit`. Diff whitespace verification: `git diff --check -- src/tasks/t3-mcp-client.ts tests/t3-production-bridge.test.ts`.

## Remaining gaps / blockers

- This is transport hardening, not production enablement. There is still no invented remote job adapter, and the existing production path intentionally fails closed.
- The client allowlist is defense in depth only and **is not a security boundary**. Real server-side bearer scope/authorization for only the intended orchestration operations is still a backend blocker.
- The focused tests instrument session deletes, stream cancellation, reconnect counts, and repeated-cycle retained protocol state. They do not prove socket/FD/heap plateaus against a real T3 backend, recursive provider-process cancellation, durable deduplication after commit-and-response-loss, or restart recovery. The N-cycle/process/DB acceptance matrix in `t3-v2-production-resource-review.md` is still needed before production activation.
- The 3-second settle/delete bounds deliberately prefer bounded shutdown. A nonconforming fetch/runtime that ignores abort beyond that bound cannot be synchronously proven cleaned up; real-server soak/fault injection must validate runtime behavior.

## Integration followup
Coordinator added split-CRLF/multiline SSE regression and normalization repair, independent cancellation of shared initialize waiters with owned handshake tracking, and fail-closed empty scoped variables. Client/tests formatted. Focused transport16 tests/55 assertions plus source verifier1 test/5 assertions pass. This remains preparatory transport, not an enabled native-job implementation.
