# Searchable original history

Die's history service retrieves bounded, attributable text from the append-only Pi session transcript. It is intended for recovering exact user-visible evidence without copying an arbitrary full transcript into a provider request.

## Scope and exclusions

- Search defaults to the current session's **active branch**. It uses the original branch rather than the compaction-aware context window, so exact dialogue remains discoverable after compaction.
- Inactive branches and other sessions are not searched implicitly.
- Cross-session calls must provide both an explicit `sessionFile` and `allowCrossSession: true` on each search or read. A ref alone never grants cross-session access. Cross-session files are opened through a read-only parser rather than the SDK persistent manager, so history reads do not create, repair, migrate, or rewrite sessions. The descriptor is opened read-only and nonblocking before it is checked, so FIFOs and other non-regular paths are rejected instead of blocking.
- Assistant thinking and tool-call payloads are never indexed.
- Hidden custom messages and `bashExecution` messages marked `excludeFromContext` are never indexed.
- Tool results deliberately removed by any `/shake` checkpoint on the active branch remain excluded. Later appends and compaction carry checkpoints cannot make those original results recoverable. Public assistant text in the same entry remains available, matching shake's projection.
- Compaction summaries, branch summaries and custom state are not indexed as original evidence. Direct user and assistant dialogue ranks ahead of execution output, reducing repeated tool-produced summaries and retrieval echoes.

These rules protect deliberately excluded/private material; they do not hide the user's own messages on the active branch.

## Execute API

`history.search({ query, cursor?, limit?, excerptChars?, sessionFile?, allowCrossSession? })`

Returns at most 20 matches by default (maximum 50), each with a bounded excerpt, a stable `die-history-v1:<session-id>:<entry-id>:<part>` ref, and provenance. Search examines at most the newest 20,000 active-branch entries and reports `scanLimited` if that bound is reached. Safety-sensitive traversal fails closed above 100,000 active-branch entries rather than partially applying exclusions. Across the selected scan, processing is limited to 100,000 message content parts and 64 MiB of text, with at most 4 MiB per text part; collecting shake policy is limited to 100,000 exclusion IDs. Exceeding these work limits rejects the request—exclusions are never truncated. Cross-session input is additionally limited to a 4,096-character path, a 64 MiB regular file, 100,000 JSONL entries, and 4 MiB per entry. Legacy v1 files are rejected because assigning their missing stable tree IDs requires migration; migrate a copy before retrieval. Use `nextCursor` to continue the same query. Cursors are tied to the query, session and a branch snapshot; later ordinary appends do not disturb the page, while switching away from that branch invalidates it. Active-branch exclusions remain live across pages, so a new shake can remove matches and shift or shorten a previously issued page.

`history.read({ ref, cursor?, maxChars?, sessionFile?, allowCrossSession? })`

Returns at most 8,000 characters by default (maximum 16,000), an exact range and provenance. Continue long text with `nextCursor`. Reads refuse refs outside the selected active branch or refs that are now excluded.

Only returned search excerpts/read pages enter the model through the ordinary execute tool result; the service does not inject history into context automatically.

## Runtime integration

`HistoryService` in `src/history/service.ts` owns validation, scoping, search, reads and provenance. The central task extension now creates that service and routes `history.search` and `history.read` from execute before job dispatch, so both helpers are available in current source. This integration is newer than the installed v0.2.3 binary and is not claimed as released or installed.
