# In-progress review by orchestrator (do not treat as final findings)

Initial disk-entry-store.ts (19:37 UTC) needs these checks before merge:
- scanJsonl catches visitor errors inside JSON parse try. MUST catch only JSON.parse. Call visit after catch. Else migration hides I/O failure and short history atomically replaces originals.
- writeLine uses one writeSync. Regular file write may be short. Loop until full. Throw on zero. On failed partial write, append rollback/ftruncate (single writer mode) to keep retry behavior.
- replace now calls dispose() before atomic replacement wins. That deletes pending spool. Failure can destroy only original pending journal and break manager. Keep old backing until replacement wins. Then clean up.
- With duplicate IDs, native byId keeps last. Cache keyed only by id may return last cached body for earlier physical entry in getEntries. Distinct offset needs identity/cache key. Validation could reject duplicate, but compatibility is expected.

Service asked for metadata branch walk helper in history-service-seam-request.md. SDK soak added scripts/history-sdk-probe.ts: 16 REAL AgentSession.compact calls with offline extension summary +128MiB original text. This is apart from test worker manager probe.

SDK seam doc now complete at wisdom/history/history-sdk-seam.md. Also repair valid final JSON line with no terminator before append (SDK adds newline on open). Else valid old original joins new record and fails on reload. Native create helper src/tasks/agent-session.ts writes reserved header wx before reopen. Pending spool must coexist and clean up without target publish collision.

Adapter first draft review (still in progress):
- Native getLeafEntry/getChildren read byId skeletons directly. Override to hydrate bodies.
- _rewriteFile called with skeleton fileEntries must hydrate them. Do not serialize skeletons and lose data. Native createBranchedSession _buildIndex after rewrite must keep label state.
- getTree must sort sibling child timestamps. Self-parent entries are roots (native behavior).
- getSessionName keeps native semantics. No extra trim unless native trims (compare).
- pathMetadata must throw on cycles/broken parents for HistoryService safety. Bound metadata export before payload hydration.
- Static open/continue/fork wrappers call original.create. Patched newSession makes pending spool. Extra adopt may clean up, but avoid two spools. forkFrom must copy old-version source compat migration through new file. Do not change source.
