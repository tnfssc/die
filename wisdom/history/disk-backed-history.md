# Disk-backed original session history

Before making session, Die CLI installs own adapter for pinned Pi 0.85.1 SessionManager. Original JSONL stays source of truth. SDK can still read it. Compaction does **not** delete originals or swap in summaries. Reopen keeps IDs, branches, labels, compaction details, and history refs.

## Memory contract

- Each persistent manager keeps at most **4 MiB of serialized body-cache buffers**. Cache does not keep parsed old entry objects. Oversized entries skip it.
- Resident offset/tree index grows with entry count. IDs, timestamps, model settings, labels, titles and session header also use memory. Total metadata space is not constant.
- Normal context build uses metadata to pick compaction window. Then it loads only those bodies. Original-history read walks metadata. It loads chosen messages/shake records bit by bit.
- Load scans JSONL in chunks. Work grows with file size. Temporary parse still needs room for largest one record.
- Native `getEntries()`, `getBranch()` and `getTree()` stay full normal-array/tree APIs. Returned objects belong to callers. Explicit exports, native SDK compaction hooks, and callers that keep arrays can load whole history. Live model context is outside cache budget too. **This does not promise flat process RSS or peak heap.**
- Explicit SDK `SessionManager.inMemory()` stays in memory. Direct SDK users and source utilities want persistent bounded cache? They must install adapter. Import alone does not change SDK.

## Persistence and compatibility

New sessions keep Pi's delayed visibility. Before first assistant response, originals go to private pending spool in same directory. First-assistant publish creates advertised path without overwriting an existing file. Reset/switch and normal process exit remove owned pending spools. Abrupt stop can leave pending spool. It is not recovered session. Pi's old pre-assistant durability kept entries only in RAM. This does not weaken it.

Appends are synchronous. They retry short writes. Failed partial append rolls back new bytes. Rewrites/migrations write temporary journal, then atomically replace destination. Failure keeps prior file. SDK parity tests cover Version 1/2 migration, branch copies, forks, reload, labels and context settings. Rewrite keeps existing symlink aliases. Existing entries are read-only API values. Mutating object does not persist it.

No lossy sidecar. No required new session format. Load rebuilds offset index from original journal. Cache-affine compaction rebuilds it too after external rewrite and `setSessionFile()`.

Supported mode has one writer on local POSIX filesystem with hard links and atomic rename. It does not coordinate concurrent writers, independently rewritten/open hard-linked aliases, or external replacement without explicit reload. Normal appends keep Pi's synchronous, non-fsync durability semantics. No database-style power-loss transaction promise. No automatic history expiry or disk quota. User still must manage disk capacity.

Project owns integration in `src/history/session-manager.ts` and `disk-entry-store.ts`. It does not patch installed dependencies. Build/check setup verifies pinned SDK version and SessionManager source hash. SDK upgrade needs direct adapter review. Private SDK entrypoints and private-field changes are not supported public APIs.

## Validation

Reproduce isolated probes without using a provider or existing user sessions:

```sh
bun scripts/history-storage-probe.ts
bun scripts/history-sdk-probe.ts
bun test --preload ./scripts/history-storage-preload.ts tests/history*.test.ts
```

First compares native/adapted managers with 136 MiB originals and 17 compactions. It checks original SHA-256 after reopen. It measures append/reset/resume. Second completes 16 real `AgentSession.compact()` calls through offline extension hook with 128 MiB original messages. This is real SDK lifecycle soak. It does not test provider-summary quality.

On measured Linux/Bun run, reopened retained heap was about **136 MiB lower** than native. Real SDK soak kept about **18–23 MiB JSC heap** across 128 MiB originals and two compacted context messages. Reset/resume returned to about 19 MiB. Full-array SDK compaction caused large temporary/allocator RSS around 0.9 GiB. It later reclaimed much of that. Measures support bounded old-history cache residency. They do not show bounded total app RSS. Exact final commands/results: `wisdom/resources/resource-fixes-history.md`.
