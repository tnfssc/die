# History release blocker followup — implemented

Both blockers fixed. No commit/tag/build/release performed; main owns final release.

## Publication consistency

DiskEntryStore.append publishes the first assistant before committing metadata, byId, cache, or assistant state. Failed exclusive link truncates the pending journal back to its previous byte size; manager leaf/skeleton and all store views remain unchanged. The collision target is untouched and retry succeeds after removing the collision. Successful link is the commit point: cleanup-unlink failure does not throw or truncate the authoritative linked file; exit cleanup retains the redundant path for retry.

Store collision/recovery and injected unlink-failure tests are in history-storage-io.test.ts; manager leaf/entries/branch/retry coverage is in history-storage-lifecycle.test.ts. Worker reran /tmp/die-history-publish-repro.ts and confirmed consistency and sentinel preservation.

## Temporary ownership

- Exported disposeDiskBackedSessionManager for known temporary owners. prepareAgentSession disposes both private managers in finally, including external header-write, reopen and metadata-append errors. Durable public header/metadata remain intact.
- Failed open replacement, selected continue load/migration, and fork publication/copy/migration release their initial pending managers deterministically.
- Native create already dispatches through patched newSession; avoid creating a redundant second pending store. continueRecent without a candidate returns its already-owned fresh manager.
- Branch-copy pending construction uses exception-safe fromEntries.
- FinalizationRegistry is a fallback for externally abandoned managers only. Known preparation/factory paths do not wait for GC or exit.
- No session_shutdown cleanup hook. Pinned core/agent-session-runtime.js fork path captures this.session.sessionManager, awaits teardownCurrent, then calls newSession/createBranchedSession on that same manager (around lines 233–240). Shutdown is not an ownership boundary.

New history-storage-cleanup.test.ts asserts zero .pending files during the live subprocess after successful preparation; failed header reservation/reopen; failed empty-file open publication and missing-file pending replacement; failed fork publication/copy and actual EEXIST; and failed selected continue load. Also verifies durable task entries/parent linkage, untouched collision/empty targets, and a genuinely owned pending manager remains usable until explicit disposal. Fixtures use unique owned mkdtemp paths and exact cleanup only.

Requested docs/history-storage.md does not exist in this checkout; existing storage documentation is docs/disk-backed-history.md (read, not edited).

## Validation

- bun test tests/history-storage.test.ts tests/history-storage-io.test.ts tests/history-storage-lifecycle.test.ts tests/history-storage-cleanup.test.ts tests/history-disk-retrieval.test.ts — **13 pass, 0 fail**.
- bun test --preload ./scripts/history-storage-preload.ts tests/history.test.ts tests/agent-session.test.ts tests/session-costs.test.ts tests/main-agent-mode-sdk.test.ts tests/task-manager.test.ts tests/task-lifecycle.test.ts tests/subagent-extension.test.ts — **83 pass, 0 fail**.
- bun scripts/history-sdk-probe.ts — **pass**, 512 originals, 16 real SDK compactions, reset/resume/post-resume append; retained heap growth **0.84 MiB**. Peak RSS remains allowed transient allocation, not a flat-RSS claim.
- bunx --no-install tsc --noEmit — **pass** (worker's intermediate agent-session type error was corrected before final check).
- Focused Biome formatting and git diff --check — **pass**.

Followup edits: src/history/session-manager.ts, src/history/disk-entry-store.ts, src/tasks/agent-session.ts, tests/history-storage-io.test.ts, tests/history-storage-lifecycle.test.ts, new tests/history-storage-cleanup.test.ts, this note. No dependencies/user state modified.
