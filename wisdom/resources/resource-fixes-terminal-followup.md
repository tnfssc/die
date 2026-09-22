# Terminal overflow follow-up

## Lifecycle finding

`Queue.end` completed only the inner RPC stream. `subscribeDynamicMapped` remained attached to the unchanged websocket session and only switched on a session change, so terminal attach could silently freeze forever on a live websocket. There was no EOF-triggered retry.

## Fix

- Subscriber overflow now terminates with a `TerminalSubscriberOverflowError` defect after draining accepted events, rather than normal EOF. The RPC client sees the defect as `RpcClientDefect`.
- Terminal attach and legacy terminal-event atoms opt into same-session transport-defect retry after 100 ms. Attach therefore invokes `terminalAttach` again and receives a fresh snapshot, repairing the event gap.
- The per-subscriber queue remains capped at 32 events and now also at 64 MiB of serialized retained events. The manager snapshot history is capped at 8 MiB; 64 MiB admits its worst-case 6x JSON escaping plus envelope fields. Output event strings have no contract-level size bound, so the byte cap also covers that hole.
- Accepted events remain ordered and are drained before the overflow failure. Other subscribers are unaffected.

## Validation

- Targeted Vitest: 2 files, 15 tests passed.
- Server and client-runtime TypeScript had no TypeScript errors (the aggregate Vite+ task still exits nonzero on existing Effect diagnostic suggestions).
- `vp fmt --check` clean after formatting; `git diff --check` clean.
