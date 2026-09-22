# T3 v2 native root review fixes

## Scope

Disposition of every finding in `.agents/notes/t3-v2-native-root-review.md`. Root `src/` and `tests/` only; no candidate/backend source was changed.

## Findings

### P0: bridge credential exposure — fixed

- Added one environment scrubber which copies the ordinary CLI environment while removing only `T3_MCP_URL` and `T3_MCP_BEARER_TOKEN`.
- Applied it to the isolated execute runner and all model-directed local children (`shell` and local `subagent`).
- The trusted parent `JobService` keeps its configured bridge context and therefore retains native `subagent` / `jobs.*` capability.
- Tests prove execute JavaScript and shell cannot read sentinel bridge values, an unrelated environment value remains visible, and execute can still call a parent-side job handler.

### P1: ambiguous successful response / internal timeout replay — fixed

- Successful HTTP responses with an absent body, malformed/structurally invalid JSON, or EOF without a matching complete SSE RPC response are classified as ambiguous post-dispatch responses.
- The MCP client's own request deadline is distinguished from owner/caller cancellation and classified as ambiguous. Caller cancellation and client close remain non-retryable aborts; non-2xx responses remain definitive.
- Native launch still performs exactly one bounded replay and reuses the same validated `clientRequestId`.
- Tests cover empty JSON, truncated SSE, internal timeout, caller abort, and HTTP 401. They assert two same-key launch POSTs only for ambiguous cases and one POST for abort/auth rejection.

### P1: unbounded launch-ledger object map — fixed

- Removed `JobService`'s permanent per-session ledger map.
- Ledger file operations now use process-local, per-path serializers retained only while operations are active. Entries are reference-counted and deleted on settlement, including failures. This preserves same-path serialization even when separate ledger objects are created for concurrent calls without retaining idle session paths.
- Churn and concurrency coverage reserves/acknowledges 300 distinct paths, checks zero retained serializers afterward, and verifies concurrent same-path reservations converge safely.

### P2: unstable mixed pagination — fixed

- Mixed local/native listing now returns a bounded, validated opaque cursor containing a stable local boundary/offset, an explicit local/native phase, and the backend's own cursor.
- Native progress no longer derives from the current local list length and backend `nextCursor` is no longer discarded. Local jobs appended after page one do not enter that pagination snapshot; local shrinkage cannot rewind native progress.
- Numeric input remains accepted for initial/backward-compatible calls; subsequent mixed pages use the opaque cursor. Pure-local pagination keeps its existing numeric cursor.
- Tests mutate local membership by both adding and removing between pages and verify native A is not duplicated and native B is not skipped.

### Completed stop marker — fixed

- `jobs.stop` now reports `cancellationRequested` only for running/cancelled native projections, not authoritative `completed` or `failed` responses.
- A completed-cancel fixture verifies the marker is absent.

## Validation

- `bun run check` — pass.
- Focused native routing + production bridge: 32 pass, 0 fail.
- Focused job bridge (including execute credential test): 17 pass, 0 fail.
- `bun run build` — pass.
- `TMPDIR=/var/tmp/... bun test ./tests` — **710 pass, 14 skip, 0 fail** (724 tests, 4,575 assertions).
- The first default-`/tmp` full run reached 707 pass but failed three compiled-binary copy/install tests because the shared tmpfs was full (`ENOSPC`, 79 MB available). Those three tests passed in isolation and the complete suite passed after moving only its temporary directory to `/var/tmp`; no product/test behavior was changed for this infrastructure condition.
