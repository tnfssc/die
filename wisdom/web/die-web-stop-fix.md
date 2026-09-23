# Die web background Stop fix (PiAdapter)

## Decision

The background-liveness banner calls the normal provider interrupt with no active turn.
In explicit Die web mode (detected by a non-empty `DIE_WEB_DIE_BINARY` in the Pi spawn environment), an idle Pi session with a running sparse `die_task_event` now treats that call as a request to stop the *owning session*.
It does not add task RPC/control state and does not change active-turn Stop semantics.
Stock Pi keeps its prior behavior.

The idle path calls the existing Pi client/session close path, allowing Die's session shutdown to SIGTERM and force owned TaskManager processes.
Only after `client.close()` and scope closure does the adapter emit one canonical `task.completed { status: "stopped" }` for each still-running tracked Die task, retaining its original turn/task identity, followed by canonical recoverable graceful `session.exited`.
A completion processed during shutdown wins through the existing task state dedupe.
The session is removed and its durable cursor/session file remains available for normal recovery on the next prompt.
A stale explicit turn id is still rejected rather than closing the idle session.

Active Pi interruption now bounds `client.abort()` at 10 seconds and returns `ProviderAdapterRequestError` on timeout.
This deliberately uses the existing reactor failure/stopSession fallback rather than waiting for the transport's generic 120-second request bound.

## Tests

Added adapter tests for:

- held abort timing out exactly at the 10-second test-clock boundary;
- a held active tool/abort settling as an interrupted original turn when released;
- idle Die web background shutdown waiting for real client close before stopped lifecycle, original-turn association, duplicate start/stop protection, session exit, durable resume, and a follow-up turn;
- unchanged stock Pi behavior for an idle sparse Die task.

Verification from `apps/server` with required environment:

`TMPDIR=/var/tmp HERDR0=1 ./node_modules/.bin/vp test run src/provider/Layers/PiAdapter.test.ts`

Result: 1 file passed, 63 tests passed.
The requested `pnpm exec vp ...` form was attempted first but pnpm's dependency-status hook tried to run an install and aborted with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; no lock/package/source edits were made by that attempt.
The already-installed local `vp` binary ran the same target successfully.
Real process-group cancellation remains for the requested later browser smoke.
