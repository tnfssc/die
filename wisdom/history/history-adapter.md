# Disk-backed SessionManager adapter

## Integration API

Install the owned adapter before calling Pi's main SDK function and before creating any persistent `SessionManager`. Dynamically import `src/history/session-manager`, call `installDiskBackedSessionManager()`, then dynamically import and call `@earendil-works/pi-coding-agent` main.

The installer can run more than once. It patches the one SDK `SessionManager` class exported by pinned `@earendil-works/pi-coding-agent` 0.85.1. It does not change SDK or `node_modules` files. `SessionManager.inMemory()` deliberately stays native and in memory.

## Behavior and ownership

Persistent managers stream JSONL into O(entry-count) metadata. That metadata holds tree links, context-selection fields, labels, model and thinking state, and byte locations. Message, custom, and summary bodies stay in the authoritative JSONL. The adapter reads them synchronously by byte range. Each manager has an LRU with an exact 4 MiB data budget, and that LRU keeps only serialized Buffers. It never caches parsed historical entry object graphs. An entry larger than the budget skips the cache. See `resource-fixes-history.md` FINAL HANDOFF for later review fixes and final evidence.

The public native APIs still materialize their results:

- `getEntries()`, `getBranch()`, and `getTree()` return ordinary arrays or trees with complete entries.
- `getEntry()` returns one complete entry.
- `buildContextEntries()` and `buildSessionContext()` choose the active path and compaction window from metadata, then load only those entries.

New sessions keep Pi's rule that a file is hidden before the first assistant message. Until then, records go to a private spool in the same directory and the advertised session path does not exist. Publication makes a no-overwrite hard link, then removes the spool. Reset, new-session, switch, and normal process exit remove owned spools. Existing empty explicit files keep Pi's immediate-header behavior.

Loads stream. Version 1/2 migration takes two streaming passes and uses atomic replacement. Rewrites use temporary files in the same directory, then fsync and rename. Stored byte offsets are rebuilt only after replacement succeeds. Normal appends keep the original JSONL as the only authority. There are no summaries or lossy sidecars.

The adapter covers static create, open, continueRecent, and forkFrom. It also covers switching, branching, labels, reload, and context or model selection. Pi's static listing APIs stay native because they return session summaries, not resident managers.
