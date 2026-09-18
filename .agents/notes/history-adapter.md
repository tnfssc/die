# Disk-backed SessionManager adapter

## Integration API

Call the owned adapter before invoking the Pi SDK main function, and before any persistent SessionManager is created. Dynamically import src/history/session-manager, call installDiskBackedSessionManager(), then dynamically import and invoke @earendil-works/pi-coding-agent main.

The installer is idempotent and patches the single SDK SessionManager class exported by pinned @earendil-works/pi-coding-agent 0.85.1. No SDK or node_modules files are changed. SessionManager.inMemory() deliberately keeps the native in-memory implementation.

## Behavior and ownership

Persistent managers stream JSONL into O(entry-count) metadata: tree links, context-selection fields, labels, model/thinking state, and byte locations. Message, custom, and summary bodies stay in the authoritative JSONL and are loaded synchronously by byte range. A per-manager LRU retains only serialized Buffers with an exact 4 MiB data budget; parsed historical entry object graphs are never cached. Entries larger than the budget are never cached. See resource-fixes-history.md FINAL HANDOFF for subsequent review fixes and final evidence.

The public native APIs remain materializing APIs:

- getEntries(), getBranch(), and getTree() return ordinary arrays or trees containing complete entries.
- getEntry() returns a complete entry.
- buildContextEntries() and buildSessionContext() first select the active path and compaction window from metadata, then materialize only selected entries.

New sessions preserve Pi's pre-first-assistant visibility rule. Before an assistant message, records are written to a same-directory private spool and the advertised session path does not exist. Publication uses a no-overwrite hard link, then removes the spool. Reset, new-session, switch, and normal process exit clean owned spools. Existing empty explicit files retain Pi's immediate-header behavior.

Loads are streaming. Version 1/2 migration uses two streaming passes and atomic replacement. Rewrite paths use same-directory temporary files plus fsync and rename, so stored byte offsets are rebuilt only after replacement. Normal appends continue to use the original JSONL as the sole authority; no summaries or lossy sidecar representations are introduced.

Static create, open, continueRecent, and forkFrom, plus switching, branching, labels, reload, and context/model selection are adapted. Pi's static listing APIs remain native because they produce session summaries rather than resident managers.
