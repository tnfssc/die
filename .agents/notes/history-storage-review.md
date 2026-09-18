# In-progress review by orchestrator (do not treat as final findings)

Initial disk-entry-store.ts (19:37 UTC) checks needed before merge:
- scanJsonl catches visitor exceptions inside JSON parse try; MUST catch only JSON.parse, then call visit outside catch. Otherwise I/O failure during migration is swallowed and shortened history atomically replaces originals.
- writeLine uses one writeSync; regular file writes can be short. Loop until full, throw on zero; append rollback/ftruncate on failed partial writes (single writer mode) to preserve retry behavior.
- replace currently dispose() deletes pending spool BEFORE atomic replacement succeeds; failure can destroy only original pending journal and leave manager broken. Keep old backing alive until successful replacement, then cleanup.
- Duplicate IDs native byId last wins; cache keyed solely by id may return last cached body for earlier physical entry in getEntries (distinct offset needs identity/cache key). Validation could reject duplicates but compatibility expected.

Service requested metadata branch traversal helper in history-service-seam-request.md. SDK soak added scripts/history-sdk-probe.ts (16 REAL AgentSession.compact calls with offline extension summary +128MiB original text) separately from test worker manager probe.

SDK seam doc now complete .agents/notes/history-sdk-seam.md. Also ensure existing valid final unterminated JSON line is repaired (SDK appends newline on open) before append; otherwise valid old original joins new record and becomes invalid on reload. Native create helper src/tasks/agent-session.ts writes reserved header wx BEFORE reopening, pending spool must coexist and cleanup without target publish collision.

Adapter initial draft review (still in progress):
- Native getLeafEntry/getChildren directly access byId skeletons; override to hydrate bodies.
- _rewriteFile called with existing skeleton fileEntries must hydrate, not serialize skeletons (loss). Native createBranchedSession _buildIndex after rewrite must not erase label state.
- getTree must sort sibling children timestamps and self-parent entries are roots (native behavior).
- getSessionName native semantics no extra trim unless native does (compare).
- pathMetadata must throw cycles/broken parents for HistoryService safety; bounded metadata export requested before payload hydration.
- static open/continue/fork wrappers call original.create -> patched newSession creates pending spool; additional adopt okay cleanup but avoid double spools. forkFrom must copy old-version source compat migration through new file without changing source.
