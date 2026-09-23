# Pi 0.85.1 SessionManager synchronous seam investigation

Date: 2026-09-18. Scope was read-only investigation; no product files were edited by this worker.

## Bottom line

Disk-backed manager can match Pi 0.85.1 only by keeping **synchronous, object-shaped SessionManager contract**. Small safe seam: install owned adapter before first session. Replace only persistent static factories (`create`, `open`, `continueRecent`, `forkFrom`). Leave `inMemory`, `list`, and `listAll` native. Adapter must be real `instanceof SessionManager` (runtime subclass or same-compatible object). It must implement every public instance action. Pin exact Pi code and fail closed. Seam relies on private layout and full method surface.

Honest promise is **bounded historical bodies kept by manager in steady state**, with O(entry-count) metadata. It does not promise constant peak RAM. Native APIs like `getEntries()`, `getBranch()`, `getTree()`, RPC `get_entries/get_tree`, branch export, and compaction hooks ask for arrays/full entries. They may briefly load large originals or let caller keep them. Cannot claim strict bounded process RAM while keeping these sync APIs. That needs upstream consumer/API changes.

## Evidence read

- Judgment: `wisdom/resources/memory-resource-judgment.md:23-29,49-52` calls this a scalability improvement, not a demonstrated leak. It requires originals on disk, branch navigation, stable refs, privacy/exclusion policy and append durability.
- Reproduction (the requested “sessionjournalprobe”): `scripts/leak-audit/session-journal.ts`, referenced by `wisdom/resources/memory-resource-audit.md:72,76`. It uses **`SessionManager.inMemory`**, appends 4 x 128 random 48 KiB user messages with compactions, and shows model context staying at two messages while original heap grows. It is baseline evidence only; a disk adapter probe must use persistent `create/open` and must not expect `inMemory` to become disk backed.
- Pi package is exactly `@earendil-works/pi-coding-agent@0.85.1`.
- Core implementation: `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js` and its d.ts.
- Native consumers: `core/sdk.js`, `core/agent-session.js`, `core/agent-session-runtime.js`, interactive/RPC modes, footer, session export, and Die consumers under `src/**`.

## What Pi actually retains and why compaction does not release it

`SessionManager` owns `fileEntries: FileEntry[]`, `byId: Map`, label maps, and `leafId` (session-manager.js around 586-697). `_appendEntry` adds full entry to `fileEntries` and `byId`, then writes it synchronously (around 739-773). `buildContextEntries` finds newest compaction on active root-to-leaf path. It returns compaction, kept prefix and later entries (around 120-201). It never drops originals. `newSession`, setSessionFile, and reload rebuild arrays/maps. So context shrinks but manager heap does not.

All instance methods are synchronous. The relevant complete public surface is:

- lifecycle/files: `setSessionFile`, `newSession`, `isPersisted`, `getCwd/Dir/Id/File/Header`, `usesDefaultSessionDir`;
- appends: message, thinking/model change, compaction, custom entry/message, session info, label change, branch summary;
- lookups/projections: leaf/entry/children/label/name, `getEntries`, `getBranch`, `getTree`, `buildContextEntries`, `buildSessionContext`;
- mutation/navigation: `branch`, `resetLeaf`, `createBranchedSession`;
- statics: create/open/continueRecent/inMemory/forkFrom/list/listAll.

Need more than methods Die calls now. Pi AgentSession and UI use almost whole API.

## Native compatibility constraints and consumers

1. **SDK creation accepts matching shape but is all sync.** `createAgentSession()` accepts an injected manager and immediately calls `getCwd`, `buildSessionContext`, `getBranch`, `getSessionId`, then may append model/thinking changes (`core/sdk.js:66-255`). No `instanceof` check there. Third-party extension may still make one. TypeScript class type is nominal because it has private members.
2. **Native AgentSession reads same manager again and again.** Persistence appends, branch navigation, compaction, statistics, export and replacement all call synchronous methods directly. Manual/automatic compaction first calls full `getBranch()` and passes that array to `prepareCompaction` and `session_before_compact` handlers (agent-session.js around 1450 and 1730). So lazy entry objects must act like normal entries on property access and JSON serialization.
3. **Hot UI paths call wide APIs.** The stock footer calls `getEntries()` during render to aggregate usage; interactive startup uses it to count compactions; `/session` statistics traverses all entries and assistant content to count tool calls; tree selector calls `getTree()`. Die's own footer/goals/cache-countdown code also calls broad APIs. Loading every entry causes repeated full-journal I/O/peaks. Later cache eviction does not prevent that.
4. **RPC exports originals on purpose.** `get_entries` and `get_tree` serialize the returned graph. Those direct actions are expected to load all and return large response.
5. **Extensions can swap sessions.** New/fork/switch/reload rebuild runtime state; captured old manager objects become stale (Pi extension docs around 1169-1295). Static factory patch must cover every replacement path. Install it before any session exists.
6. **Die has its own paths.** `src/tasks/agent-session.ts` creates a manager, externally writes its header with `wx`, reopens it, then appends custom/session-info entries. Cross-session history opens a session too. Prompt preview/tests may skip CLI bootstrap. Bounded behavior there needs direct install. Importing module does not quietly patch every entrypoint.

## Required file semantics (easy places to break behavior)

- **Delayed first flush:** a newly created native session reserves a filename but does not create it until an assistant message exists. Before that, entries remain resident. Once the first assistant is appended, Pi creates with `wx` and writes header + all entries. Conversely, opening an existing header-only file sets `flushed=true`, so later non-assistant entries append immediately. A bounded adapter needs a hidden same-filesystem pending spool or an explicit bounded fallback; writing the public file early changes discovery behavior.
- **Publish atomically and exclusively:** pending spool publication must fail if the target appeared, like native `openSync(..., "wx")`. Keep the journal authoritative; update an index only after journal append. A stale/missing index must be rebuildable.
- **Open/repair parity:** native load skips blank/malformed lines, accepts a valid final unterminated JSON line and appends a newline, rejects a nonempty file with no valid session header, and initializes a truly empty explicit file. A scanner must use byte offsets (not JS character offsets), handle lines larger than its chunk, partial writes, CRLF, and UTF-8 split boundaries.
- **Migrations:** v1 assigns collision-checked IDs/parents and converts `firstKeptEntryIndex`; v2 renames `hookMessage` to `custom`; migration rewrites the canonical file. A streaming migration is possible, but index arithmetic must match the SDK's parsed-entry array exactly (including the header and skipped malformed lines), and replacement must preserve the original on failure.
- **Append details:** IDs are collision checked against all existing IDs; parent is current `leafId`; labels are real entries and update latest label/timestamp maps; append advances the leaf even for state/label entries. A single `writeSync` is not guaranteed to write a whole buffer—loop until complete.
- **Rewrites/identity changes:** `newSession` clears state and computes a new timestamped path. `setSessionFile` switches in place. `createBranchedSession`, despite its name, switches the current manager to a new file, strips/rechains label entries, repairs compaction `firstKeptEntryId`, recreates labels, changes session ID/path, and honors delayed flush. `forkFrom` creates a new header/ID/cwd/parentSession but copies all parsed non-header entries and returns an opened manager.
- **Durability:** native appends are synchronous but not fsynced. It is fine to improve rewrite/publish durability, but document it and fsync the containing directory if claiming rename durability. Never delete the only pending source before a replacement has succeeded.
- **External mutation/concurrency:** native has no multi-process writer lock and an opened manager does not merge outside changes. The adapter should at least fail/rebuild on unexpected inode/size/mtime rather than read stale offsets. Do not advertise multi-writer safety without a lease design.

## Minimal safe architecture

1. Keep the canonical Pi JSONL byte-compatible and authoritative. Use a temporary pending spool before first assistant, then atomically/exclusively publish it. Do not introduce a new lossy session format.
2. On open, perform a bounded-memory synchronous chunk scan. Retain compact metadata per entry: type/id/parent/timestamp/offset/length plus fields needed without body hydration (message role/provider/model/usage/tool-call count as needed, compaction boundary, model/thinking changes, labels/session name). Keep an ID-to-metadata map and label/leaf state. Be honest that this is O(number of entries), and that arbitrary large labels/names/IDs are still payload unless made lazy.
3. Keep full serialized bodies on disk and a byte-accounted LRU (for example 4 MiB). Cache accounting must include actual retained object/string size conservatively, not merely JSON byte length if asserting a hard JS-heap bound. Entries larger than budget should be returned uncached.
4. Provide stable, ordinary-looking entry objects or materialize on each explicit API call. Metadata-only native loops should not parse content. If using getters/proxies, verify enumerable properties, `Array.isArray`, spread, JSON.stringify, identity expectations and mutation behavior. A simpler first implementation may materialize arrays, but then document those APIs as demand-driven transient exceptions.
5. Implement `buildSessionContext` specially: walk parent metadata from leaf, locate latest compaction/settings, and hydrate only compaction-aware context entries. Do not implement it as `buildSessionContext(getEntries())`; that defeats the goal. Likewise expose a metadata branch iterator for HistoryService so stable-ref/privacy traversal does not first materialize the full branch.
6. Preserve native `inMemory` untouched. Preserve async discovery `list/listAll` unless there is evidence they retain full sessions. Patch persistent factory statics once, idempotently, before main creates a manager. The 0.85.1 static descriptors are writable/configurable, so this works with ESM's shared class object.
7. For `instanceof` and extension compatibility, prefer a runtime subclass of the actual SessionManager. Because the declaration has a private constructor/private members, this requires a narrowly isolated cast at the construction seam. Invoke the native constructor only in a tiny in-memory/minimal mode; opening a path through `super` would already load the whole file. Override every public operation and fail closed if the pinned method surface/hash changes. A plain structural wrapper is easier but breaks nominal typing/possible `instanceof` consumers.
8. Ensure all replacement paths use patched factories. Keep an uninstall hook only for isolated tests; production should install once. Coordinate with Die's `resume-safeguards`, which patches `list/listAll`, rather than overwriting those functions.

## Review observations on the concurrent draft store

At investigation time another worker had created uncommitted `src/history/disk-entry-store.ts`; I did not edit it. Useful follow-ups before integration:

- `writeLine` currently uses one `writeSync`; loop for partial writes.
- `replace()` calls `dispose()` before the new replacement succeeds. For a pending manager this can unlink the only spool and lose recoverable state on any later error. Build/flush/publish replacement first, then retire old storage.
- The current metadata retains full label and session-name strings, so the body budget is not strict for arbitrarily large state fields. Document metadata scaling or make those values lazy.
- `materializeAll()` and `replace(Array.from(entries))` necessarily have caller-sized peaks. This matches the qualified goal, not strict bounded peak RAM.
- Rescan currently accepts a final partial valid line but does not visibly perform native newline repair. Validate and repair before later append or two JSON values can concatenate.
- Add stale-offset checks around external replacement/truncation and ensure temporary pending/rewrite files have a cleanup/recovery policy after crashes.

## Validation gate

Use persistent replacement for in-memory audit probe: >=128 MiB incompressible original bodies, many compactions, forced GC/settling, then append after compaction, branch/reset, `newSession`, reopen/resume, `setSessionFile`, `createBranchedSession`, `forkFrom`, label paths, cache/custom compaction, malformed/final-partial JSONL and v1/v2 migrations. Check exact original bytes/IDs/parents/refs survive reopen and full-demand APIs. Check compacted normal context stays small. Report metadata/cache heap separately. Compare with unpatched Pi 0.85.1 in subprocess fixtures. Also run `createAgentSession`, native manual/automatic compaction events, interactive footer/tree, RPC get_entries/get_tree, extension new/fork/switch/reload, and Die history privacy/shake exclusions.
