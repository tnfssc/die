# Independent v0.4.0 history storage review

## Verdict

**BLOCKED: one release-blocking resource/privacy cleanup defect.** I did not find an original-history loss or branch-context parity blocker in exercised successful paths. Pending journals can be orphaned for the lifetime of a long-running process.

## Release blocker: pending spools leak beyond manager ownership

- `DiskEntryStore.pending()` creates a real file and registers it in process-global `liveSpools` (`src/history/disk-entry-store.ts:21-28,280-300`).
- Cleanup occurs only through explicit `dispose()` or the process exit hook (`disk-entry-store.ts:345-355`). Manager ownership is a `WeakMap` (`session-manager.ts:42`), but there is no manager disposal hook/finalizer. Dropping a manager therefore does not remove its spool; the global set retains the pathname until exit.
- This occurs in normal integration: `prepareAgentSession()` creates a manager, reserves its target header itself, then opens a second manager (`src/tasks/agent-session.ts:11-17`). The first disk-backed manager is abandoned with its pending spool.

Concrete isolated reproduction (owned `/tmp/die-history-review-*`, removed afterward) called `prepareAgentSession()` once and listed the directory before exit. It contained both the intended `2026-...jsonl` and `2026-...jsonl.pending-2301033-ce36013b-69ca-432f-b81a-2b1deb040a0b`. Every prepared task can therefore leave a hidden journal in a long-lived parent. Before assistant publication these spools also contain delayed user transcript data, making this resource accumulation and longer-than-owner retention of transcript data.

Failure cleanup has the same defect. `SessionManager.forkFrom()` obtains a manager through `original.create` (which dispatches through patched `newSession` and creates a pending store), but does not dispose it when exclusive publication/copy/migration fails (`session-manager.ts:441-465`). An isolated target-collision reproduction caught `EEXIST`; before cleanup the directory held the untouched collision target and `...collision-target.jsonl.pending-...`. The passing collision test does not check this cleanup.

Required release fix: deterministic ownership cleanup for abandoned/replaced managers and all exceptional static factory paths, plus integration that does not abandon the initial `prepareAgentSession` manager. Do not rely solely on process exit/GC. Add live-process assertions that no `.pending-*` files remain after task preparation and failed fork/open/continue paths.

## Successful checks / no blocker found

- `bun test tests/history-storage.test.ts tests/history-storage-io.test.ts tests/history-storage-lifecycle.test.ts tests/history-disk-retrieval.test.ts`: **10 pass, 0 fail**.
- `bun scripts/history-sdk-probe.ts`: **pass**; 512 originals, 16 real SDK compactions, resume and post-resume append survived, final heap growth 0.84 MiB. High transient RSS is not treated as a blocker under the stated peak-RAM allowance.
- Covered delayed target publication, append/reopen, compaction-original preservation, branch copy, newSession, fork, migration, tail repair, short-write rollback, failed atomic replacement, duplicate IDs, bounded serialized cache, metadata traversal, refs, and shake exclusions.
- Branch context at `session-manager.ts:123-147,262-275` matches pinned 0.85.1 ordering: latest compaction summary, retained pre-compaction tail, then post-compaction path; thinking/model settings derive from the complete active path.
- Rewrites hydrate bodies rather than serializing metadata skeletons (`session-manager.ts:212-230`), and flushed replacement is atomic. No successful-path original-data loss was reproduced.
- Active retrieval is metadata-first and hydrates selected message/shake bodies (`history/service.ts:163-189,366-431`). Full-array SDK APIs and bounded cross-session reads may materialize by design and are not defects.

## Minor parity observation (not a release blocker)

For an invalid explicit `fromId`, pinned SDK `buildSessionPath()` falls back to the last entry, while adapter `pathMetadata()` returns an empty path (`session-manager.ts:108-121`). Internal callers use valid IDs and fail-closed behavior is safer, so this odd SDK edge is not classified as a blocker.
