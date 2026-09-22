# Resource ownership and limits

Die keeps useful history, but bounds automatic caches and output retention. These policies apply starting with v0.4.0.

## Job output

Running jobs each retain the most recent **1,000,000 bytes** of combined stdout/stderr. Completed jobs share an **8,000,000-byte** retained-output budget, including retained subagent final-answer strings. Oldest completed output is discarded first; IDs, status, timestamps and other job metadata remain available for the session.

Inspection offsets remain offsets into the original logical output, not a renumbered retained buffer. If an explicitly requested offset has been evicted, `jobs.inspect` reports `outputLost` and the available range. This is bounded output inspection, not a promise to archive every shell log. Save important full output to a file deliberately. Active work, pending delivery snapshots, and job metadata are separate from this completed-output budget.

The internal `TaskManager` hook `completedOutputBudgetBytes` can customize the completed budget for embedders/tests; it is not a CLI setting.

## Execute text capture

The execute tool has a **10 MiB (10,485,760-byte)** combined stdout/stderr complete-capture budget by default. Its optional `outputByteLimit` argument accepts a non-negative safe integer. A value of zero disables complete-byte retention, not the separately bounded inline preview.

Above the byte limit, Die continues draining the child output but does not append excess bytes to capture artifacts. The response explicitly reports truncation. `outputBytes` counts observed bytes, `capturedOutputBytes` counts retained bytes, and `outputTruncated` distinguishes limited capture from complete output. Per-stream counters and artifact errors remain available. A truncated file must not be treated as a complete log.

The inline preview remains separately limited to 4,000 combined decoded characters. There is no new default execution timeout. Increase `outputByteLimit` deliberately when a larger capture is required, or have the command write an explicit log file.

These are application output policies, not a security sandbox: execute code can still allocate memory or write its own files.

## Durable artifacts

Session-backed execute artifact paths remain evidence associated with the session. Die does not silently expire them while keeping the session and its references. No automatic global TTL or session-deletion command is introduced by these fixes. Cumulative disk consumption can therefore grow with retained work; users should deliberately archive/delete obsolete session evidence and associated artifacts when no longer needed, not while an execution is writing them.

Bounded RAM, unlimited historical data, and finite total disk cannot all be guaranteed simultaneously. Disk-backed history reduces residency; it does not make storage free.

## Shutdown

On POSIX, the web launcher creates an owned backend process group. SIGINT/SIGTERM are forwarded to that group; after a five-second grace period the launcher escalates to SIGKILL. It also terminates remaining members of the group when the leader exits. User-requested INT/TERM produces status 130/143. The launcher never signals its own or an unrelated process group.

This contains members of the owned group, not arbitrary deliberately detached daemons or an OS-wide process tree. Windows retains direct-child fallback and has no new process-tree guarantee.

## Web caches

Highlighter promises and remembered unsupported language labels each have a 64-entry LRU bound; unsupported labels resolve through canonical text highlighting. Recent PR handoff prompts are bounded to 128 draft entries. Evicting an old draft's cache entry does not delete the draft or its content.

## Persistent original history

Persistent Pi session journals remain authoritative JSONL files. Die indexes entry locations and keeps at most **4 MiB of serialized historical entry bodies** in its cache, loading originals when requested. This does not delete originals or replace them with summaries. Branches, stable history references and retrieval exclusions remain supported. In-memory sessions retain their native behavior.

This is a body-cache bound, **not a fixed total process-memory promise**. Metadata grows with the number of entries, live model context requires memory, and explicit full-history APIs/native compaction can materialize large arrays temporarily. The footer caches only reduced usage statistics so unchanged renders do not repeatedly load the whole journal. See [disk-backed history](../history/disk-backed-history.md) for compatibility and validation details.

## Terminal subscribers

Each terminal subscriber's producer queue is capped at **32 events and 64 MiB of serialized event payload**. The byte allowance accommodates the existing 8 MiB terminal-history snapshot even with worst-case JSON escaping. The downstream ACK window remains separate.

Overflow unsubscribes only the slow consumer, drains accepted events in order, and fails the stream explicitly. Terminal clients retry after 100 ms on transport failure; attach obtains a fresh bounded-history snapshot. This repairs the gap instead of leaving a silently frozen terminal. Healthy subscribers and terminal processing are not blocked behind a slow browser. This is not an unlimited terminal-log archive.

## Provider logs and auxiliary state

Provider log sinks exist only for a flush batch rather than for every historical thread. Aggregate retention includes current thread files; the existing defaults are 512 MiB total and 14 days, checked at the existing five-minute retention cadence. Usage can temporarily exceed a target between checks. Deleted log paths are recreated safely on later writes.

Pi keyed locks retire only after their final holder/waiter leaves. Optional Pi extension task trackers retain at most 50 finished records each, while active records remain live; the default Die task projection keeps its existing 50-entry policy.
