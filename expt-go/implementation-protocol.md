# Protocol adapter implementation

## Scope

`internal/app/protocol.go` is a CLI-only translation layer. It does not change the engine, provider, runtime, session format, TUI, or tool selection. Provider-native SSE remains available to session/provider persistence but a `core.StreamEvent{Type: "native"}` is not copied to CLI JSON output.

## Evidence used

The implementation was based on the installed original sources, not an inferred protocol:

- `node_modules/@earendil-works/pi-coding-agent/dist/modes/print-mode.js` writes the session header before subscribing and writes each translated event as one JSON line.
- `dist/modes/json-event.js` removes cumulative `partial` messages, emits delta-only `message_update` records, and adds `id`/`toolName` to `toolcall_start`.
- `dist/modes/rpc/rpc-mode.js`, `rpc-types.d.ts`, and `docs/rpc.md` establish newline-framed requests, immediate prompt acknowledgements, asynchronous events, and the `response/command/success/data/error` envelope.
- `docs/json.md` documents session header version 3 and lifecycle event shapes.
- `evidence/live-tool/original.stdout` supplies observed ordering: session, agent start, turn start, user start/end, assistant start/updates/end, tool execution start/end, tool-result start/end, turn end, next turn, agent end, agent settled. It also confirms source tool-call IDs, final message metadata, nested usage cost objects, and `willRetry`.
- `evidence/original/cli.json` was checked as the synthetic CLI fixture. Tests use only local actual-shaped records and a fake provider; they do not make live requests.

## JSON mapping

`NewJSONEmitter(w, app)` returns a concurrency-safe JSON-lines emitter. Call `Start(userText)` once before `Application.Submit`, pass `emitter.Emit` as the callback, then call `End(err)` exactly once.

The adapter:

- emits the Pi v3 session header once and an agent lifecycle for each Start/End;
- places the user message after the first internal `turn_start`;
- turns streamed native text into `text_start`, delta-only `text_delta`, and `text_end` updates;
- uses the final internal message as authoritative, preserving Pi-shaped native message metadata and nested cost data while retaining native tool IDs;
- emits tool-call update records before assistant `message_end`, then orders `tool_execution_start` records by assistant source order even if concurrent callbacks arrive out of order;
- emits tool execution end and tool-result message lifecycles before `turn_end`;
- converts terminal errors to Pi-shaped assistant error/aborted messages rather than inventing a raw protocol event;
- finishes with `agent_end` and `agent_settled`.

The adapter intentionally does not claim byte-for-byte parity. Godie's core does not currently expose every Pi event (thinking deltas, extension/session-entry events, queue updates, tool partial updates, or per-category cost at every text delta). Missing values are not guessed. `Err()` reports output failures after callback use.

## RPC subset

`RunRPC(ctx, app, reader, writer)` accepts JSON objects separated by newlines. Frames are capped at 1 MiB. Output writes are serialized with asynchronous prompt event writes. Only one prompt is active at a time; the prompt response is written before its event goroutine starts. EOF waits for an accepted local prompt to finish.

Implemented commands are:

- `prompt`, `abort`;
- `get_state`, `get_messages`, `get_session_stats`;
- `get_available_models`, `set_model` for the already configured provider;
- `get_available_thinking_levels`, `set_thinking_level`.

The available-model response deliberately contains only the configured model; it is not presented as a provider catalog. Provider switching is rejected. Unknown and unsupported commands receive a structured unsuccessful response. API keys, auth state, system prompts, and environment variables are never returned.

## Exact coordinator integration

No `cmd/godie/main.go` change is included here. The coordinator can integrate print JSON mode as:

```go
emitter := app.NewJSONEmitter(os.Stdout, application)
emitter.Start(userText)
runErr := application.Submit(ctx, userText, emitter.Emit)
emitter.End(runErr)
if emitErr := emitter.Err(); runErr == nil {
    runErr = emitErr
}
```

RPC mode is one call (and owns reading until EOF/context termination):

```go
runErr := app.RunRPC(ctx, application, os.Stdin, os.Stdout)
```

The TUI should continue using its own callback and must not route through this adapter.
