# Operational diagnostics

Operational diagnostics use a fixed list of reason codes and small bounded fields. They do not store request bodies, prompts, headers, free-form exception messages, or tool output. Existing session transcripts and direct job-output inspection do not change. This is not broad transcript redaction.

Use `/diagnostics` for the current activation's bounded ring and health counts. Use `/diagnostics durable` for checked records from session history. Records are version 1 `die-diagnostic` custom entries in the existing session JSONL. They are not model-facing messages. Before adding a diagnostic child, the extension saves the old leaf and tests restoration through the public `branch`/`resetLeaf` API. If that API is missing or the test fails, it refuses the optional write. The pinned SDK checks a branch target before changing its leaf. After a normal write, the extension restores the old runtime leaf at once.

This isolation is best effort, not a transaction. Another API implementation could pass the test and then throw only after the append. There is no public rollback API in that case, so runtime-leaf restoration is not certain. The write failure is contained and counted. On reopen, the current SDK picks the last JSONL entry. The reopened leaf may therefore point to a visible diagnostic child. Leaf position is neither saved nor promised across reloads. Conversation context and extension authority do remain unchanged because diagnostic custom entries do not enter model context.

The recorder keeps the latest 100 entries in memory. It removes duplicate durable records and allows at most 128 durable entries in each seeded session history. Inspection counts dropped, invalid, duplicate, budget-dropped, and failed writes. Durable replay scans backward through at most 10,000 entries and says when the scan was limited. A missing record does not prove that an operation did not happen. When the durable budget is full, current in-memory inspection still works. Diagnostic storage is best effort. It cannot replace a checkpoint or projection that correctness depends on.

An optional logger must not throw into inference, trigger provider retries, or hide the first operation error. Starting dispatch does not prove network send or billing. Existing usage records remain the source for cost. Diagnostic fields are not a second charge record.

Async work tied to a session must capture `diagnosticRecorder(owner)` when it starts. It must not look up a recorder after the active session changes. The recorder rejects stale attachment generations. Shutdown diagnostics remain for later lifecycle listeners. Startup attaches the next generation.

Jobs also have a protected session-owned index at `<session-file>.jobs.jsonl`. It keeps the newest lifecycle records within 2 MiB. Those records include stop causes and child-session pointers, but not commands, prompts, or output. The index does not reconnect old jobs to `jobs.inspect`. An abrupt host death before a record is written cannot be seen later.

Lifecycle locking calls the Linux x64 libc advisory-lock ABI through Bun FFI. It needs no helper executable. The kernel releases the lock when the process dies. If locking is unsupported or busy, the optional record is dropped with a distinct diagnostic. It is never written without a lock.
