# Optional Herdr lifecycle adapter

## Scope and activation

`internal/herdr` is an independent Go adaptation of the Pi-compatible Herdr lifecycle wire protocol. It has no package side effects that inspect Herdr environment variables or open sockets. A coordinator must explicitly call:

```go
reporter, err := herdr.FromEnvironment(root, interactive)
if err != nil { /* configuration is malformed; continue without Herdr */ }
if reporter != nil {
    defer reporter.Close()
    reporter.Session(sessionFile, sessionID)
}
```

The integration point belongs only in the interactive root coordinator. Print, JSON, RPC, and child/subagent paths must pass false for the applicable flag. As defense in depth, `FromEnvironment` also requires `HERDR_ENV=1`, nonempty bounded `HERDR_SOCKET_PATH` and `HERDR_PANE_ID`, depth zero, and no `DIE_SUBAGENT_TYPE`. A malformed inherited depth fails closed. `New(Config)` is available to embedders and tests without consulting the process environment.

## Lifecycle mapping

The coordinator emits only lifecycle metadata:

- `Session(path, id)` sends `pane.report_agent_session`; an absolute sanitized path is preferred and a bounded ID is the fallback.
- `State(Working)`, `State(Idle)`, and `State(Blocked, message)` send `pane.report_agent`. The blocked message is optional, sanitized, and bounded.
- `Close()` discards stale queued state, interrupts an in-flight stale report, performs bounded `pane.release_agent` attempts, and stops the pump.

Reports use source `herdr:die` and agent `pi`. Herdr 0.7.x understands the Pi identity but has no end-to-end native die identity. Every wire attempt receives a process-monotonic sequence number. Requests contain pane identity, lifecycle state, and session reference only. User prompts/input, conversation content, model/provider credentials, and environment secrets are never fields in this protocol.

## Transport behavior

Each newline-delimited JSON request uses a fresh `net.UnixConn`. Delivery means the peer returned at least one response byte. The first attempt has a 250 ms deadline and one retry has a 750 ms deadline; tests and embedders may configure shorter bounds. Dial, write, acknowledgement, timeout, and close failures are nonfatal.

A single goroutine drains the queue in wire order. Pending session reports coalesce with pending session reports, and pending state reports coalesce with pending state reports, so bursts retain the latest unsent value without unbounded growth. The pump uses a capacity-one wake channel and connection deadlines rather than recurring timer goroutines. `Close` terminates it after the release attempt.

## Tests

The package tests use only Unix sockets created beneath `t.TempDir()` and explicitly replace every relevant environment variable. They verify session/state/release schema and ordering, compatible identity, monotonic sequences, session-ID fallback, child/headless/malformed-environment disablement, and graceful bounded behavior for missing and nonresponsive sockets. They never connect to an inherited Herdr socket.
