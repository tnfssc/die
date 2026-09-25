# T3 v2 native root review fixes

## Scope

Disposition of every finding in `wisdom/t3/t3-v2-native-root-review.md`. Root `src/` and `tests/` only. No candidate/backend source was changed.

## Findings

### P0: bridge credential exposure — fixed

- Added one environment scrubber which copies the ordinary CLI environment while removing only `T3_MCP_URL` and `T3_MCP_BEARER_TOKEN`.
- Applied it to the isolated execute runner and all model-directed local children (`shell` and local `subagent`).
- The trusted parent `JobService` keeps its configured bridge context and so keeps native `subagent` / `jobs.*` capability.
- Tests prove execute JavaScript and shell cannot read sentinel bridge values, an unrelated environment value is still visible, and execute can still call a parent-side job handler.

### P1: ambiguous successful response / internal timeout replay — fixed

- Successful HTTP responses with an absent body, malformed/structurally invalid JSON, or EOF without a matching complete SSE RPC response are classified as ambiguous post-dispatch responses.
- The MCP client's own request deadline is distinguished from owner/caller cancellation and classified as ambiguous. Caller cancellation and client close stay non-retryable aborts. non-2xx responses stay definitive.
- Native launch still performs exactly one bounded replay and reuses the same validated `clientRequestId`.
- Tests cover empty JSON, truncated SSE, internal timeout, caller abort, and HTTP 401. They assert two same-key launch POSTs only for ambiguous cases and one POST for abort/auth rejection.

### P1: unbounded launch-ledger object map — fixed

- Removed `JobService`'s permanent per-session ledger map.
- Ledger file operations now use process-local, per-path serializers kept only while operations are active. Entries are reference-counted and deleted on settlement, including failures. This keeps same-path serialization even when separate ledger objects are created for concurrent calls without retaining idle session paths.
- Churn and concurrency coverage reserves/acknowledges 300 distinct paths, checks zero kept serializers afterward, and verifies concurrent same-path reservations converge safely.

### P2: unstable mixed pagination — fixed

- Mixed local/native listing now returns a bounded, validated opaque cursor containing a stable local boundary/offset, an explicit local/native phase, and the backend's own cursor.
- Native progress no longer derives from the current local list length and backend `nextCursor` is no longer discarded. Local jobs appended after page one do not enter that pagination snapshot. Local shrinkage cannot rewind native progress.
- Numeric input is still accepted for initial/backward-compatible calls. Later mixed pages use the opaque cursor. Pure-local pagination keeps its existing numeric cursor.
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
- The first default-`/tmp` full run reached 707 pass but failed three compiled-binary copy/install tests because the shared tmpfs was full (`ENOSPC`, 79 MB available). Those three tests passed in isolation and the complete suite passed after moving only its temporary directory to `/var/tmp`. No product/test behavior was changed for this infrastructure condition.

## v0.11.2 release dry-run ledger regression (2026-09-25)

At d13ea62 hosted CI passed, but Release dry run 36110554528 timed out the bounded-ledger eviction test at Bun's 5,000 ms default; the next test saw one active serializer. The old eviction fixture called `reserve` 261 times in series on the same path. Each new entry requires an atomic write, file sync and directory sync. The timed-out async loop continued after Bun advanced to later tests, so the global serializer count of one is consistent with test-work bleed, not evidence of a persistent runtime leak. The churn test's 300 independent paths finished in 969 ms even in that release run.

The eviction test now seeds a valid full on-disk ledger at the boundary, retaining the first identity from a real `reserve`, then exercises actual durable overflow, reload and replay writes through separate ledger instances. It asserts capacity, oldest eviction, replacement and restored deterministic identity. This removes 255 unnecessary serial fsynced fixture writes without changing runtime or loosening the zero-active-serializer assertion in the following concurrency test. No asynchronous work is left behind on the normal test path; no global timeout increase. Local timings before/after: 59.37 ms / 2.13 ms (local storage is much faster than the hosted Release runner).
