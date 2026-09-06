# Operational diagnostics

New operational diagnostics contain allowlisted reason codes and bounded metadata, not request payloads, prompts, headers, arbitrary exception messages, or tool output. Existing session transcripts and explicit job-output inspection remain unchanged; this is not a general transcript redaction feature.

Use /diagnostics for this activation's bounded diagnostic ring and health counters. Use /diagnostics durable to inspect validated records from session history. Entries use the die-diagnostic custom-entry type, version 1, in the existing session JSONL, not model-facing messages.

The recorder retains 100 recent entries in memory, deduplicates durable records, and caps durable entries at 128 per seeded session history. Inspection reports dropped, invalid, deduplicated, budget-dropped, and write-failure counts. Durable replay scans backwards up to 10,000 entries and reports a limited scan; lack of a record is not proof that an operation did not occur. Once the durable budget is exhausted, current in-memory inspection remains available. Diagnostic persistence is best effort and cannot substitute for correctness-critical checkpoint or projection persistence.

Optional logger failures must not throw onto inference paths, cause provider retries, or replace the original operation failure. Dispatch initiation is not proof of network transmission or billing. Existing usage records remain the cost authority; diagnostic metadata does not add a second charge.

Session-bound asynchronous work must capture diagnosticRecorder(owner) when it begins, rather than resolving a recorder after a session switch. The recorder invalidates stale attachment generations. Shutdown diagnostics remain available to later lifecycle listeners; startup reattaches the next generation.

Job ownership also has a protected, session-bound index at <session-file>.jobs.jsonl. It retains newest lifecycle records within 2 MiB, including termination causes and child-session pointers but no commands, prompts, or output. It does not reattach historical jobs to jobs.inspect; abrupt host death before a record is written remains unobservable.

Lifecycle locking uses the Linux x64 libc advisory-lock ABI through Bun FFI; no external helper executable is required. The kernel releases locks on process death. Unsupported locking and contention drop the optional record with distinct diagnostics rather than risk an unlocked write.
