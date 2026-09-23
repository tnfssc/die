# Searchable original history

Die history service reads bounded text with clear source from append-only Pi session transcript. Use it to find exact user-visible evidence. No need put whole transcript in provider request.

## Scope and exclusions

- Search starts with the current session's **active branch**. It reads the original branch, not the compaction-aware context window. Exact dialogue can still be found after compaction.
- Search does not silently include inactive branches or other sessions.
- Cross-session calls must provide both an explicit `sessionFile` and `allowCrossSession: true` on each search or read. A ref alone never grants cross-session access. Cross-session files are opened through a read-only parser rather than the SDK persistent manager, so history reads do not create, repair, migrate, or rewrite sessions. The descriptor is opened read-only and nonblocking before it is checked, so FIFOs and other non-regular paths are rejected instead of blocking.
- Assistant thinking and tool-call payloads are never indexed.
- Hidden custom messages and `bashExecution` messages marked `excludeFromContext` are never indexed.
- Tool results deliberately removed by any `/shake` checkpoint on the active branch remain excluded. Later appends and compaction carry checkpoints cannot make those original results recoverable. Public assistant text in the same entry remains available, matching shake's projection.
- Compaction summaries, branch summaries and custom state are not indexed as original evidence. Direct user and assistant dialogue ranks ahead of execution output, reducing repeated tool-produced summaries and retrieval echoes.

These rules protect excluded/private material. They do not hide user's own messages on active branch.

## Execute API

`history.search({ query, cursor?, limit?, excerptChars?, sessionFile?, allowCrossSession? })`

Default returns at most 20 matches (maximum 50). Each has bounded excerpt, stable `die-history-v1:<session-id>:<entry-id>:<part>` ref, and source. Search checks at most newest 20,000 active-branch entries. It reports `scanLimited` at bound. Safety-sensitive walk fails closed above 100,000 active-branch entries. It never applies only some exclusions. Selected scan allows 100,000 message content parts and 64 MiB text, at most 4 MiB each part. Shake policy allows 100,000 exclusion IDs. Going over work limit rejects request. Exclusions never truncate. Cross-session input also allows 4,096-character path, 64 MiB regular file, 100,000 JSONL entries, and 4 MiB each entry. Legacy v1 files fail because missing stable tree IDs need migration. Migrate copy before retrieval. Use `nextCursor` for same query. Cursors bind to query, session and branch snapshot. Later normal appends do not move page. Switching branch invalidates it. Active-branch exclusions stay live across pages. New shake can drop matches and shift or shorten old page.

`history.read({ ref, cursor?, maxChars?, sessionFile?, allowCrossSession? })`

Default returns at most 8,000 characters (maximum 16,000), exact range and source. Use `nextCursor` for rest. Reads reject refs outside selected active branch or now excluded.

Only search excerpts and read pages from normal execute result enter model context. Service never inserts history itself.

## Runtime integration

`HistoryService` in `src/history/service.ts` owns checks, scope, search, reads and source. Central task extension creates service. It routes `history.search` and `history.read` from execute before job dispatch. Both helpers exist in current source. Persistent CLI sessions use owned disk journal adapter in [disk-backed history](./disk-backed-history.md). Retrieval walks branch metadata before loading selected bodies. Compacted originals need not stay in RAM. Same privacy, stable-ref and live shake-exclusion rules apply. Source change does not alter running or installed binary.
