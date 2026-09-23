# CLI/RPC long-session lifecycle leak audit

## Scope and safety

Audited the real compiled `dist/die` RPC process against an in-process, loopback OpenAI-compatible fake model.
No paid/external API was used.
Every run used a fresh `/var/tmp/die-cli-runtime-soak-*` root with isolated `HOME`, `PI_CODING_AGENT_DIR`, and `DIE_CODING_AGENT_DIR`.
The harness only terminated the exact child it spawned on error.
It does not use `pkill` or touch an existing server/session.

Reusable harness: `scripts/leak-audit/cli-rpc-soak.ts`.

It exercises real JSONL RPC parsing, extension loading, prompts, delayed-response aborts, manual compaction commands, session replacement, final stdin-close shutdown, and samples Linux `/proc` RSS/HWM/VM, threads, FD count, and recursive children.
A `DIE_SOAK_NEW_ONLY=1` mode isolates session replacement/teardown from model traffic.

## Results

### Mixed runtime soak

Command:

`DIE_SOAK_CYCLES=2000 bun scripts/leak-audit/cli-rpc-soak.ts`

* 2,000 loop iterations. 100 real `new_session` replacements, 166 delayed turn aborts, 133 manual compaction attempts, 2,000 local model requests, 30,706 RPC events.
* die exited cleanly with status 0 after stdin EOF. Stderr empty.
* Recursive child count was 0 at every sample.
* Threads settled from 16 to 17 and stayed there.
* FDs settled at 11/12 (the variation tracks the delayed loopback request cadence), with no increasing trend.
* RSS rose from 112,544 KiB cold to 176,076 KiB at turn 1,000 and 195,572 KiB at turn 2,000.
  The fitted slope dropped from about 44.3 KiB/turn in turns 1-1,000 to 17.7 KiB/turn in turns 1,000-2,000, but this mixed run did **not** establish an RSS plateau.
  This is a residual risk, not enough by itself to prove live-object retention: RSS includes Bun/JSC allocator high-water behavior and no heap snapshot was available externally.
* All 133 compaction commands reached the real extension lifecycle but returned the expected `Compaction cancelled` response before making a summarization request.
  The configured local generic provider does not satisfy die's native/cache-affine compaction route.
  So this run exercises compaction cancellation and cleanup, not successful compaction.
  Journal retention itself is intentionally outside this audit.

### Session replacement teardown isolation

Command:

`DIE_SOAK_CYCLES=2000 DIE_SOAK_NEW_ONLY=1 bun scripts/leak-audit/cli-rpc-soak.ts`

* 2,000 consecutive real `new_session` operations, 0 model requests, 14,005 RPC events, clean status-0 exit.
* FD count was exactly 9 throughout. Threads exactly 16. Recursive children exactly 0.
* RSS showed GC/allocator sawtooth rather than accumulation: 194,060 KiB at replacement 1,000, then ranged 172,276-217,528 KiB through replacements 1,000-2,000, ending at 208,252 KiB.
  Linear slope over the final 1,000 replacements was **-12.1 KiB/replacement**.
* This shows practical plateau for the session teardown path: old AgentSession/SessionManager/extension instances are not producing monotonic RSS, FD, thread, or child growth under very aggressive replacement.

A shorter 600-turn mixed run had the same stable FD/thread/child behavior and RSS 161,540 KiB at its final sample.

## Lifecycle code audit

Pinned upstream pi 0.85.1 has the expected ownership chain:

* `AgentSessionRuntime.teardownCurrent` aborts/settles the active turn, emits `session_shutdown`, invokes the invalidation hook, then calls `AgentSession.dispose()` before applying the replacement (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session-runtime.js:102-123`).
  `newSession` uses that path before creating and rebinding the next runtime (lines 147-172).
* `AgentSession.dispose()` aborts retry/compaction/branch-summary/bash/agent work, invalidates the extension runner, disconnects its agent subscription, clears all event listeners, and calls `cleanupSessionResources(sessionId)` (`.../core/agent-session.js`, `dispose()` near generated line 680).
* RPC rebind unsubscribes both the old session event subscription and agent backpressure subscription before attaching new ones (`.../modes/rpc/rpc-mode.js:225-273`).
  Final shutdown removes signal handlers, unsubscribes both, awaits `runtimeHost.dispose()`, detaches stdin readers, pauses stdin, flushes, and exits (lines 580-652).
* Interactive/TUI replacement uses the same RuntimeHost.
  Final quit awaits `runtimeHost.dispose()` before stopping the UI (`.../modes/interactive/interactive-mode.js:3229-3249`).
  `stop()` disposes selectors/status, disables theme auto-sync, clears extension terminal-input listeners, disposes footer providers, unsubscribes the session, stops the TUI, and unregisters signals (generated lines 5527-5545).

Die integration follows those events:

* `src/tasks/extension.ts:552-580` resets per-session UI state on start. On shutdown it clears instruction continuity and status, shuts down instruction mode, completion/attention machinery and TaskManager, detaches diagnostics, and clears manager/service/context references.
* Session-keyed instruction state, manual-shake projection failures/applications, and patches use `WeakMap` (`src/tasks/instruction-continuity.ts:49-53`, `src/tasks/manual-shake.ts:35-56`).
* The process-global resume picker maps are bounded/ref-counted: metadata LRU is capped, while root adapters are uninstalled on `session_shutdown` (`src/tasks/resume-safeguards.ts:61-73,109-143,181-184`).
* Memory and goal extensions also clear their active controller/store state on `session_shutdown` (`src/memory/extension.ts:407-412`, `src/goals/extension.ts:285-291`).

No concrete missed unsubscribe, persistent timer, FD, signal-listener, or owned-child teardown leak was found in the CLI/RPC/TUI integration.

## Assessment / limitations

**Conclusion:** practical session teardown plateaus under 2,000 replacements. OS resources stay bounded in a 2,000-turn mixed run.
There is no demonstrated FD/thread/child leak.
The mixed workload's RSS still drifts upward after warmup, so it would be too strong to claim a complete heap plateau.
A future follow-up should run the compiled binary with an explicitly supported JSC/Bun heap-profiler mode (if available) and compare retained types after 1,000 vs 2,000 turns.
Externally sampled RSS cannot distinguish retained JS objects from allocator arenas/JIT/network pools.

Successful native/cache-affine compaction was not feasible with the generic local fake route in this harness.
The cancellation path was soaked.
This avoids duplicating the separate journal/compaction-retention audit.
