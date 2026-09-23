# Current web server resource fixes — implemented

2026-09-18. Owned product scope: .cache/die-t3code-v0042/apps/server/** only. HEAD verified as 719a76ca1dbf5490f1aa33ffb9966301e02be9a9. Read memory-resource-audit.md, memory-resource-judgment.md, and leak-audit-current-web.md. No frontend/core edits, patch regeneration, commits/tags, paid APIs, or user-server/process operations.

## Decisions and implementation

### Terminal upstream subscribers
- New src/terminal/SubscriberStream.ts; wired into terminalAttach and subscribeTerminalEvents in src/ws.ts.
- Each subscriber has a 32-event nonblocking upstream callback queue, not merely the existing downstream ACK window.
- On the first rejected offer, unsubscribe that listener immediately; drain the accepted ordered prefix and explicitly complete its stream. No silent drop-and-continue and no global producer backpressure. Healthy subscribers retain their full ordered stream.
- Registration/finalization is idempotent, including overflow during registration.
- src/terminal/SubscriberStream.test.ts blocks a real Effect stream consumer while publishing 256 events to slow and healthy streams. Slow listener is removed, its delivered prefix is exactly 33 events (one in-flight plus 32 queued), healthy receives all 256 plus ten subsequent events.
- This proves the actual upstream stream adapter bound; it is not a full WebSocket/RSS soak or a total-process byte budget. Queue capacity is in events. Existing PTY/history/ACK limits stay separate.
- Metadata, preview, and terminal internal processing queues unchanged: insufficient evidence for blanket rewrites.

### Provider log retention
- src/provider/Layers/EventNdjsonLogger.ts and EventNdjsonLogger.test.ts.
- Removed service-lifetime per-thread sink map. Sinks now exist only while a synchronized flush batch is written; reconstructed sinks read current file size, preserving rotation.
- Aggregate age/byte retention no longer exempts current thread files. All owned logs count against the quota. Existing retention-check cadence remains (quota enforced at retention passes, not on every write).
- Regression: 100 distinct completed-thread writes stay <= 1,024 bytes at retention checks rather than retaining 100 exempt files. Active-file quota test includes file eviction and successful later recreation by the same thread. Existing rotation, concurrent writes, and attribution tests pass.

### Pi locks and optional extension records
- src/provider/Layers/PiAdapter.ts and PiAdapter.test.ts.
- Keyed lock registry counts holders AND waiters and uses acquire/use/release for interruption-safe retirement. Delete only when the last user leaves; semaphore identity survives queued callers.
- Regression proves three-caller mutual exclusion/ordering and idle retirement, 300 unique failed locked operations each returning registry size to zero, and interrupted waiter/holder cleanup.
- Finished optional subagent and workflow extension records limited to 50 per tracker; running records retained; oldest finished entries pruned. Recent deduplication preserved. Default Die task projection cap remains 50.
- Extension regression projects 60 completed tool results, confirms old-entry eviction and recent-entry deduplication (61 starts/completions after replaying oldest and newest).

## Changed files relative to the already applied canonical patch

- apps/server/src/ws.ts
- apps/server/src/terminal/SubscriberStream.ts (NEW)
- apps/server/src/terminal/SubscriberStream.test.ts (NEW)
- apps/server/src/provider/Layers/EventNdjsonLogger.ts
- apps/server/src/provider/Layers/EventNdjsonLogger.test.ts
- apps/server/src/provider/Layers/PiAdapter.ts
- apps/server/src/provider/Layers/PiAdapter.test.ts

All source paths above are under .cache/die-t3code-v0042. Other staged server changes predate this task and are part of the original canonical patch. Do not discard them.

## Validation

From .cache/die-t3code-v0042/apps/server:

../../node_modules/.bin/vp test run src/terminal/SubscriberStream.test.ts src/terminal/OutputProtocol.test.ts src/terminal/Manager.test.ts src/terminal/NodePtyAdapter.test.ts src/terminal/BunPtyAdapter.test.ts src/provider/Layers/PiAdapter.test.ts src/provider/Layers/EventNdjsonLogger.test.ts src/provider/pi/PiRpcClient.test.ts

Result: **8 files / 202 tests passed** (combined final run). Pi 70, logger 17, terminal 101, Pi RPC 14.

../../node_modules/.bin/tsc --noEmit

Final server typecheck: **passed (exit 0)** after correcting a test-only Effect `return yield*` diagnostic. Pi 70-test suite reran successfully after that correction. Existing Effect advisory suggestions are non-fatal. One attempted shell wrapper used POSIX syntax under fish and failed before running. Reran directly.

Final formatting check passed for all seven changed files. Worker formatting/lint passed. Git diff --check -- apps/server passed.

## Canonical patch capture — MAIN OWNER ONLY, after all workers finish

Do NOT use git diff --cached alone: original patch is staged but new fixes are unstaged. New SubscriberStream files are currently untracked and must be included explicitly. Review status for all frontend/other worker additions too.

From repository root (shell-neutral individual commands):

    git -C .cache/die-t3code-v0042 rev-parse HEAD
    git -C .cache/die-t3code-v0042 status --short
    git -C .cache/die-t3code-v0042 add -N apps/server/src/terminal/SubscriberStream.ts apps/server/src/terminal/SubscriberStream.test.ts
    # Main also intent-to-add any other approved new worker files.
    git -C .cache/die-t3code-v0042 diff --binary HEAD > web/t3.patch

Capture the WHOLE canonical delta against pinned HEAD, including pre-existing staged patch and all approved concurrent frontend changes. Do not restrict capture to apps/server. Review newly tracked paths to avoid build artifacts. Verify patch applies to a fresh isolated checkout of the exact pin, then run the above tests/typecheck there. Do not require the old patch reverse-check during work: overlapping new edits can intentionally invalidate it until main recaptures. Old audit probes asserting the previously demonstrated leaks are historical repros, not expected-to-pass post-fix tests. Use the committed source regressions above.

Status: implementation and validation complete. No web/t3.patch writes run by this task.
