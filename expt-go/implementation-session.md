# Session/product implementation API

Package `godie/internal/session` is stdlib-only.

- `New(Config) (*Session, error)` creates a version-2 Godie JSONL file; `Open(Config)` opens a Godie file, takes an exclusive `.lock`, validates its tree, and repairs only an invalid non-newline torn tail. `Close` releases both. Config accepts `StateDir`/`SessionFile`, `CWD`, child `Metadata`, and injectable `Now`/`NewID` for isolated tests.
- `AppendMessage(core.Message)`, `AppendMessageWithUsage(core.Message, *core.Usage)` and active-branch `Usage()`, `AppendCustom(type, data)`, `Branch(optionalLeaf...)`, `Messages()`, and `Resume(leafID)`. Every entry has a stable ID, parent ID, timestamp and is fsynced before return. Provider `Message.Native` JSON is retained as the raw JSON value without projecting it into a reduced provider-neutral shape.
- `OpenReadOnly(path)` is the only legacy Pi/import path. It never opens writable, repairs, locks, migrates, or appends. `Open` rejects headers not marked `app:"godie"` with `ErrLegacyReadOnly`.
- `NewHelper(session) core.Helper` routes both namespaces. `NewHistory(session)`; `Handle(ctx, "history.search"|"history.read", rawArgs)`. Search limits: query 500 chars, results 1..50, excerpts 40..600; reads 1..16000. Refs are `die-history-v1:<session>:<entry>:<part>`; cursors are bounded and pinned to query/ref/session/branch snapshot. A different `sessionFile` requires `allowCrossSession:true` and is opened strictly read-only. Manual-shake tool-result exclusions are fail-closed.
- `NewGoals(session)`; `Get/Set/Update/Clear`, `Handle(ctx, "goal.get|set|update|clear", rawArgs)`, and `Slash("set|status|pause|resume|clear ...")`. State is custom-entry branch state, so Resume changes it durably without rewriting. Restoration treats every `die-goal` entry as an authority boundary and validates the complete version-1 schema fail-closed, including required/status-specific fields, safe revisions, list/progress/aggregate limits, and JavaScript UTF-16 code-unit lengths. Unknown extension fields remain tolerated. Helper callers cannot set waiting/pending job IDs and must pass required arrays (including an explicit, possibly empty `constraints` array).

Metadata stores role/type, depth, task/model, parent session ID/file, and root session ID in the header and a `die-agent` custom entry for child sessions.

## Known product gaps

Goal automatic continuation/no-progress scheduling and live owned-job reconciliation belong to app/job orchestration and are not implemented in this package. Pi import is deliberately read-only; no migration writer exists. History indexes the Go core message text shape (plus compatible Pi string/text-part fixtures), not arbitrary provider-native payload internals.
