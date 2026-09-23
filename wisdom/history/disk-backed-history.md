# Disk-backed original session history

Before it creates a session, Die's CLI installs its own adapter for pinned Pi 0.85.1 `SessionManager`. The original JSONL stays authoritative and readable by the SDK. Compaction does **not** delete originals or replace them with summaries. Reopening keeps IDs, branches, labels, compaction details, and history refs.

## Memory contract

- Each persistent manager retains at most **4 MiB of serialized body-cache buffers**. Parsed historical entry objects are not retained by that cache. Oversized entries bypass it.
- A resident offset/tree index scales with entry count. IDs, timestamps, model settings, labels, titles and the session header also occupy memory; this is not constant total metadata space.
- Normal context construction selects the compaction window using metadata, then loads only its bodies. Original-history retrieval traverses metadata and loads selected messages/shake records incrementally.
- Loading scans JSONL in chunks. Work is proportional to file size; transient parsing still requires the largest individual record.
- Native `getEntries()`, `getBranch()` and `getTree()` remain full, ordinary-array/tree APIs. Their returned objects belong to callers. Explicit exports, native SDK compaction hooks, and callers retaining those arrays can materialize the whole history. Live model context is also outside the cache budget. **This is not a flat process-RSS or peak-heap guarantee.**
- Explicit SDK `SessionManager.inMemory()` stays in memory. Direct SDK users and source utilities must install the adapter themselves if they want persistent bounded-cache behavior; importing it alone does not change the SDK.

## Persistence and compatibility

New sessions retain Pi's delayed visibility: before the first assistant response, originals are stored in a private same-directory pending spool; first-assistant publication creates the advertised path without overwriting an existing file. Reset/switch and normal process exit retire owned pending spools. Abrupt termination can leave a pending spool; it is not an automatically recovered session. This does not weaken Pi's original pre-assistant durability contract, which kept those entries only in RAM.

Appends are synchronous and retry short writes; failed partial appends roll back the new bytes. Rewrites/migrations write a temporary journal and atomically replace the destination, preserving the prior file on failure. Version 1/2 migration, branch copies, forks, reload, labels and context settings are covered by SDK parity tests. Existing symlink aliases are preserved during rewrite. Existing entries are read-only API values, not a mutation-through-object persistence interface.

There is no lossy sidecar or mandatory new session format. The offset index is rebuilt from the original journal on load. Cache-affine compaction's external rewrite followed by `setSessionFile()` rebuilds it as well.

The supported mode is a single writer on a local POSIX filesystem supporting hard links and atomic rename. Concurrent writers, independently rewritten/open hard-linked aliases, and external replacement without explicit reload are not coordinated. Normal appends retain Pi's synchronous, non-fsync durability semantics; this is not a database-style power-loss transaction guarantee. There is no automatic history expiration or disk quota. Disk capacity still needs explicit user management.

The integration is source-owned in `src/history/session-manager.ts` and `disk-entry-store.ts`, not a modification of installed dependencies. Build/check preparation verifies both the pinned SDK version and SessionManager source hash; an SDK upgrade requires explicit adapter review. Private SDK entrypoints or mutation of its private fields are not supported public APIs.

## Validation

Reproduce isolated probes without using a provider or existing user sessions:

```sh
bun scripts/history-storage-probe.ts
bun scripts/history-sdk-probe.ts
bun test --preload ./scripts/history-storage-preload.ts tests/history*.test.ts
```

The first compares native/adapted managers with 136 MiB of originals and 17 compactions, checks original SHA-256 after reopen, and measures append/reset/resume. The second completes 16 actual `AgentSession.compact()` calls through an offline extension hook with 128 MiB of original messages. It is a real SDK lifecycle soak, not a provider-summary quality test.

On the measured Linux/Bun run, reopened retained heap was about **136 MiB lower** than native. The real SDK soak retained roughly **18–23 MiB JSC heap** across 128 MiB of originals, with two compacted context messages; reset/resume returned to about 19 MiB. Full-array SDK compaction caused large transient/allocator RSS (around 0.9 GiB), subsequently reclaiming substantially. These measurements support bounded historical-cache residency, not bounded total application RSS. See `wisdom/resources/resource-fixes-history.md` for exact final commands/results.
