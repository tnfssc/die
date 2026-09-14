# Project memory implementation

## Scope and ownership

Project memory is implemented by the standard-library-only package godie/internal/memory. It stores ordinary Markdown below .agents/notes/; it has no database, model-facing memory tool, project lock, git behavior, automatic summary, or lifecycle trigger.

The coordinator owns restored root-session identity and all provider/job calls. Memory fails closed unless PrepareRequest.Root is true. Calling Prepare is explicit per invocation and is the only way this package creates consolidation work; it never starts a worker itself.

## Public Go API

New(projectRoot, Logger) binds a store to one absolute project root. The optional logger receives metadata-only Event values for snapshot, prepare, save, consume, and commit operations; note bodies and constraints are never logged.

Low-level filesystem API:

- SnapshotPending returns stable, path-sorted PendingNote snapshots containing path, exact bytes represented as a Go string, and lowercase SHA-256.
- Consume(snapshot, stillValid) publishes immutable content-addressed markers. It does not remove or rewrite producer-owned pending files. The callback lets a coordinator fail closed when session ownership changes.
- Read(topic), Save(topic, content, expectedSHA256), and VerifySave(receipt) support root and nested topic indexes. A nil expected hash creates only when absent; a supplied hash replaces only the version read by the caller.

Explicit consolidation API:

1. The coordinator calls Prepare with a PrepareRequest. Profiles are exactly fast and normal; constraints must be non-empty (use none explicitly only when accurate). No pending notes returns ErrNoPending and creates no worker or receipt.
2. Preparation contains the run identity held privately by the package plus public Prompt, Paths, and nonce-named absolute ReceiptPath. The coordinator launches its provider child with that prompt. Preparation itself has no provider/job dependency.
3. After a terminal child result, the coordinator calls Commit(preparation, Completion), supplying current restored Root identity and optionally a StillValid ownership callback. A nonzero or unsuccessful result returns ErrWorkerFailed. A successful result still must have a valid receipt and unchanged saved bytes. Only then are the captured pending snapshots marked consumed. The nonce receipt is removed after every commit attempt; partial Markdown output remains for later reconciliation.

The coordinator must not call commit while a worker may still write, and must discard or retain snapshots if restored root identity or project ownership changes. The package deliberately has no polling or hidden in-flight registry.

## Layout and protocol

Only direct .md children of .agents/notes/.pending/ are inputs. Subdirectories and other extensions are ignored. Consumption markers live in .agents/notes/.consumed/ and are named by SHA-256 of path + NUL + content. Their payload records source path and content SHA-256. Publishing uses a fully written temporary file and a hard link, so an existing marker is never overwritten.

The child receipt is JSON with a files array whose entries have path and sha256 strings. Paths are relative to .agents/notes/, use forward slashes, contain no empty, dot, parent, hidden, absolute, or backslash segment, and end in Markdown. Entries must be unique. Every listed regular file is read and hashed, and the list must include exactly named index.md at the notes root. A receipt proves exact saved bytes, not semantic quality.

## Exact bounds

All limits apply to bytes, not rune counts:

| Resource | Limit |
|---|---:|
| Pending direct Markdown files | 256 |
| One pending file | 1 MiB |
| Aggregate pending snapshot | 8 MiB |
| Receipt JSON | 64 KiB |
| Receipt entries | 256 |
| One receipt-listed Markdown file | 2 MiB |
| Aggregate receipt-listed Markdown | 16 MiB |
| Existing consumed-marker read | 1 KiB |

Limits and unsafe managed paths fail closed before consumption. Existing symlinked managed directories, pending files, saved files, receipt files, and marker files are rejected. Files are bounded during the actual read as well as by metadata checks.

## Changed-content and failure safety

Pending source files are never deleted. If x.md changes after preparation, committing the old snapshot marks only the old path/content identity; the replacement has a different marker and appears in the next snapshot. A malformed, missing, oversized, duplicate, escaping, symlinked, or hash-mismatched receipt consumes nothing. A saved Markdown file changed after receipt creation fails hash verification and retains every input. Failed workers likewise retain every input. Invalid caller-created pending hashes are retained.

Save uses an expected-hash check, a same-directory temporary file, sync, and rename. This catches stale content observed before writing. As in the original implementation, this is not a compare-and-swap primitive: without a project lock, another writer can race after the check. Consolidation is not a multi-file transaction and partial worker writes are not rolled back. Existing-path symlink checks reduce accidental traversal but do not claim an adversarial filesystem sandbox against ancestor replacement races.

## Tests

store_test.go translates the key original scenarios entirely into t.TempDir: stable direct-note selection, count/per-file/aggregate bounds, symlink rejection, immutable consumed markers, changed-source retry, invalidation, expected-hash saves, explicit root/profile/constraints gating, coordinator prompt preparation, successful verified commit, failed child retention, changed saved-content rejection, mandatory root index, receipt cleanup, and metadata logging.

## Application command integration

    func (a *Application) memoryCommand(ctx context.Context, args string) (string, error)

is implemented in internal/app/memory.go for the command coordinator to dispatch from the /memory case. It accepts only status (also the empty argument) and consolidate fast|normal --constraints TEXT. Both operations require restored root identity (application depth and persisted session depth are zero). Status snapshots through memory.Store and never launches a child. An empty consolidation snapshot also launches no child.

Consolidation captures the application session, runtime, project root, session identifiers, and persisted ancestry before Prepare. It launches exactly one managed subagent using Preparation.Profile and Preparation.Prompt, with a three-second foreground wait. If still running, it waits only on that returned job ID using Runtime.Call("jobs.inspect") on a 250 ms supervisor ticker; it never reads the global Runtime.Events channel and does not create model turns. Commit is called only after that owned child is terminal. The memory package then verifies the nonce receipt and exact saved bytes before publishing markers, while StillValid rechecks captured ownership during publication. Cancellation stops only the owned child, waits up to ten seconds for the runtime TERM/KILL lifecycle, and performs failure cleanup only if terminality is observed.

No memory-package or runtime changes are required for executable integration. A future Runtime.WaitJob(ctx, id) API would remove the small internal inspection ticker and is preferred, but its absence is not blocking and must not be worked around by consuming global Events.
