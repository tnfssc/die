# Independent code review: Go runtime/provider/session

## Review snapshot and method

Reviewed the in-progress, untracked `godie` tree as it existed at **2026-09-13T20:00:59Z**, against repository HEAD `14981b44d68988261dbe056227c952671963c838` and the original TypeScript implementation under `src/`. Because implementation was active, line references and findings apply to this content snapshot; representative SHA-256 values are `runtime/execute.go a493d445…`, `runtime/jobs.go 2d59d761…`, `runtime/assets/runner.js 7ea11cbf…`, `provider/openai.go 9e53079a…`, `provider/anthropic.go a2444ea5…`, `provider/gemini.go f83acccf…`, and `app/application.go 54795c4c…`. Findings explicitly marked tentative are known unfinished areas rather than claims about final scope.

Narrow non-live validation: `cd godie && go test -race ./internal/runtime ./internal/provider` passed (cached). No credentials, provider calls, broad kills, or shared-state-mutating tests were used.

## Findings

### P0 — A blocked stdin write holds the job mutex and makes stop and runtime shutdown hang indefinitely

**Current:** `godie/internal/runtime/jobs.go:388-407` takes `j.mu` and performs the potentially blocking pipe `Write` while still holding it. `stop` must acquire the same mutex before it can signal the process (`:205-225`), and `Runtime.Close` calls `stop` synchronously before starting its bounded wait (`:527-552`). Output capture and reaping also need that mutex (`:153-203`).

**Reproduction:** launch a job that never reads stdin, with `closeInput:false` (for example `sleep 600`), then call `jobs.input(id, "x".repeat(1_000_000))`. Once the OS pipe fills, the helper blocks holding `j.mu`. `jobs.stop(id)` and application shutdown then block before they can send TERM or reach the shutdown watchdog. This can wedge the whole process and also prevents output from being drained.

**Contract comparison:** original `src/tasks/task-manager.ts:387-399` awaits stream backpressure without a shared state lock; `kill` remains independently able to signal at `:409-428`, and shutdown is bounded at `:431-455`.

**Fix:** never hold the state mutex across pipe I/O. Snapshot/validate the stdin handle and state, write outside the lock with cancellation, then reacquire only to update state. Close/stop must be able to interrupt an outstanding write.

### P1 — Clean execute-worker exit does not reap its process group; descendants can leak or make Execute hang

**Current:** `godie/internal/runtime/execute.go:205-247` waits only for the Bun leader. It signals the process group only on context cancellation (`:208-217`). After a normal leader exit it waits for stdout/stderr/image pumps (`:219-223`), but never kills residual group members.

**Reproduction:** execute JS that spawns a long-lived subprocess and exits. If the descendant uses ignored stdio, `Execute` returns while the descendant survives. If it inherits the worker's stdout/stderr descriptors, the leader exits but `ioWG.Wait()` can wait indefinitely for EOF. A timeout-less execute therefore either leaks a process or hangs.

**Contract comparison:** original `src/typescript/execution.ts:123-132` deliberately sends SIGKILL to the execute process group when the leader exits, specifically to prevent descendant leaks and inherited-pipe close hangs. Managed shell jobs are separately owned and must survive; arbitrary worker descendants are not.

**Fix:** on leader exit, reap the execute worker group (with PID/process-group identity captured for this invocation) before waiting for final pipe EOF. Keep managed jobs in their independently created groups.

### P1 — The bridge has no response ACK/ownership protocol, and the app treats every foreground completion as a background completion

**Current:** the Go bridge writes a response and considers delivery complete (`godie/internal/runtime/execute.go:169-203`); the runner merely reads it (`godie/internal/runtime/assets/runner.js:3-19`) and sends no ACK. Independently, every job completion is always emitted (`godie/internal/runtime/jobs.go:175-203`), and `Application.Submit` consumes every `completed` event as a new background-job model turn (`godie/internal/app/application.go:74-88`), even when that completion was already returned synchronously to `shell()`.

**Reproduction:** from execute, `await shell("printf done", {waitSeconds: 3})`. The job normally completes in the foreground and its result is returned to the current tool call, but its buffered `completed` event is subsequently converted into another `Engine.Turn`. The model sees/processes one completion twice. Conversely, killing the runner after Go writes but before JS consumes the response gives no reliable way to return completion ownership to session notification delivery.

**Contract comparison:** original `src/tasks/task-manager.ts:342-380` transfers completion ownership only after worker acknowledgement and restores notification ownership on disconnect. `src/typescript/job-bridge.ts:236-289` sends/parses explicit ACK frames, while `src/typescript/execution.ts:166-170` commits ACKs only on clean worker completion.

**Fix:** implement the bidirectional ACK lifecycle and track per-job delivery ownership. Suppress background notification for cleanly acknowledged foreground results; restore it exactly once on disconnect/unclean worker exit.

### P1 — Synchronous one-byte RPC defeats concurrency and prevents handoff from releasing foreground waits

**Current:** `rpc()` performs a synchronous byte-at-a-time `readSync` loop before returning a Promise (`godie/internal/runtime/assets/runner.js:3-20`). Thus promise construction itself blocks the Bun event loop and all helper calls serialize. Although Go accepts handoff at `godie/internal/runtime/execute.go:181-192`, it has no mechanism to cancel outstanding foreground waits.

**Reproduction:**

```js
await Promise.all([
  shell("sleep 60", { waitSeconds: 60 }),
  handoff("waiting")
]);
```

The first array element blocks inside `readSync`, so `handoff` is not even invoked for roughly 60 seconds. Two ostensibly parallel shell launches similarly start serially. This violates the documented immediate handoff/user-turn behavior and can deadlock dependency patterns between concurrent helpers.

**Contract comparison:** original `src/typescript/extension.ts:81-101` aborts outstanding foreground waits when handoff arrives without killing managed jobs; its bridge is asynchronous and multiplexed (`src/typescript/job-bridge.ts:250-300`).

**Fix:** use asynchronous framed reads with an ID-indexed pending map; permit concurrent requests. Give handoff a control path that aborts only foreground waiting and then complete the clean-exit ACK transfer.

### P1 — Runtime shutdown cannot cancel execute calls that specified a timeout

**Current:** `Execute` registers the cancel function for a `WithCancel(parent)` context at `godie/internal/runtime/execute.go:85-92`, then replaces `ctx` with a separately derived `WithTimeout(parent)` context at `:93-97`. `Runtime.Close` calls only the registered, now-disconnected cancel functions (`godie/internal/runtime/jobs.go:527-532`). Execute goroutines are also absent from the runtime wait group.

**Reproduction:** start `Execute` with a long positive timeout and code that never exits, then call `Runtime.Close()` while its parent remains live. Close returns without canceling/reaping that Bun group; the invocation runs until its own timeout and continues using runtime/helper state after shutdown.

**Fix:** derive timeout from the already registered cancellable context (or register the final cancel), account execute invocations in shutdown waiting, and do not close shared channels/state until all execute bridges are torn down.

### P1 — Provider-native replay ignores provider/model provenance and can disclose opaque state to another backend

**Current:** all three adapters replay any assistant `Message.Native` that happens to decode into their expected broad shape: OpenAI at `godie/internal/provider/openai.go:209-223`, Anthropic at `godie/internal/provider/anthropic.go:23-30`, and Gemini at `godie/internal/provider/gemini.go:31-39`. None checks `Message.Provider` or `Message.Model`, despite those fields being persisted in `godie/internal/core/types.go:14-16`.

**Reproduction:** create/resume a session containing an OpenAI assistant native output array, then resume it with Anthropic or a different model. Anthropic's `json.Unmarshal(..., &[]any)` succeeds and forwards OpenAI-native items as Anthropic assistant content. The reverse OpenAI path also accepts arbitrary arrays. Besides malformed requests, opaque/encrypted reasoning or provider metadata can be sent to a different provider/model. Same-provider model changes are unsafe for model-bound opaque checkpoints.

**Contract comparison:** the original native checkpoint prompt explicitly says state can only be resumed by the original provider and model (`src/prompts/native-compaction.md:1`), and cache-affine compaction rejects identity changes (`src/tasks/cache-affine-compaction.ts:445-520`).

**Fix:** replay native content only when exact provider and model provenance matches the active request. Otherwise reconstruct only normalized visible text/tool calls, or fail closed for opaque checkpoints that cannot be safely normalized.

### P1 — Truncated provider streams are accepted as successful complete turns

**Current:** `readSSE` treats clean EOF as success after flushing the last data frame (`godie/internal/provider/http.go:39-77`). OpenAI does not require `response.completed` before returning success (`godie/internal/provider/openai.go:65-150, 194-202`); Anthropic does not require `message_stop` (`godie/internal/provider/anthropic.go:73-181`); Gemini likewise accepts EOF without a terminal finish indication (`godie/internal/provider/gemini.go:75-136`).

**Reproduction:** an `httptest` server returns HTTP 200/SSE, writes one text delta (or a partial tool call), then closes without the provider terminal event. Each adapter returns a nil error and the engine persists that partial assistant message. For OpenAI, no completed envelope can produce an apparently successful empty/native-[] response. A retry is thereby suppressed and subsequent tool correlation/history can be corrupted.

**Fix:** track and require each provider's terminal success event/status. EOF before it must be a retryable/incomplete-response error and must not be committed as an accepted assistant turn.

### P2 — Job completion is published before stdout/stderr capture is known complete

**Current:** capture goroutines and the reap goroutine run independently (`godie/internal/runtime/jobs.go:147-150`). `reap` closes `j.done` and emits completion immediately after `Cmd.Wait` (`:175-203`), without joining both capture pumps. `foreground` can therefore inspect immediately on `j.done` (`:477-494`) and miss trailing bytes; later capture mutates offsets after the job was declared complete.

**Reproduction:** have a short-lived command write a large final burst to both stdout and stderr, then repeatedly foreground/inspect at completion. Scheduling can close `done` before the capture goroutines append the tail, yielding a non-final completion result/event.

**Fix:** make completion publication wait for both pumps, while preserving a separate process-exited state if needed. Follow the original ordering in `src/typescript/execution.ts:146-165`, which awaits output pumps after process completion before forming the result.

## Tentative unfinished blockers

- **Native/cache-affine compaction is absent in the current Go packages.** No `godie/internal` implementation invokes either compaction prompt or a provider-native compaction/checkpoint flow; `godie/implementation-provider.md` lists native compaction as an intentional current gap. This is a parity blocker for long sessions (provider context exhaustion becomes hard failure instead of preserving/recovering state), but is marked tentative because implementation is active. The original safety behavior is substantial: `src/tasks/cache-affine-compaction.ts:445-724` preserves the conversation and refuses unsafe identity/budget/failure cases; `src/tasks/native-compaction.ts` owns Codex-native handling.
- **Mixed parallel handoff semantics need an explicit test.** `godie/internal/app/engine.go:123-143` ends the turn only when *all* parallel execute calls hand off. If one call requests handoff and another returns normally, inference continues despite the handoff contract. Given active app work, treat this as tentative until intended multi-tool termination semantics are settled; the safe rule should ensure one acknowledged handoff cannot be silently overridden by a sibling result.

## Auth-specific note

No credential exfiltration/logging defect was found in the reviewed auth lane: import is explicit and narrows to the Codex credential (`godie/internal/provider/auth.go:33-63`), isolated files are mode 0600, and non-2xx provider bodies are discarded (`godie/internal/provider/http.go:32-36`). The cross-provider native replay finding above remains a provider-data disclosure issue and should be fixed before session/provider switching is enabled.
