# Independent judgment: intentional history/resource retention

Date: 2026-09-18
Scope: judgment only.
No product changes.
Reviewed `wisdom/resources/memory-resource-audit.md`, `wisdom/resources/leak-audit-current-web.md`, `leak-audit-cli*.md`, and the cited CLI source/dependency paths.

## Verdicts

| Area | Verdict | Judgment |
|---|---|---|
| Completed-job RAM | **FIX** | Put an aggregate byte budget on retained completed-job output. Keep job summaries/IDs for the session; when old output is evicted, make `jobs.inspect` report `outputLost`. Disk backing is optional, not required. |
| Original transcript after compaction | **POLICY** | Current retention is semantically intentional and correct: compaction bounds model context, while branch navigation and searchable original history require originals. Decide and document the supported session-size/RAM contract. Implement lazy disk-backed history only if effectively unbounded/flat-RAM sessions are a product requirement. |
| Execute artifact size | **FIX** | Add an explicit per-execution capture limit with clear truncation/error metadata. Complete, automatic capture of a noisy stdout/stderr stream should not be able to consume the remaining disk by accident. |
| Execute artifact lifetime | **POLICY** | Define ownership and deletion semantics, preferably tying session-backed artifacts to explicit session deletion/cleanup. Do not silently expire a path while the owning session remains supported; OS temp policy is a reasonable fallback for no-session artifacts if documented. |
| Generic concurrent helper requests | **NEED EVIDENCE** | Do not prioritize a generic in-flight bridge cap from the current evidence alone. Frames are bounded, teardown releases requests, and no retained-byte/latency or realistic accidental-concurrency measurement was supplied. Measure slow concurrent observational calls and concurrent task launches separately first. |

## Rationale and challenges to the audit recommendations

### Completed jobs — FIX, but use the narrower remedy

`TaskManager.#tasks` is session-lifetime (`src/tasks/task-manager.ts:135-194`), completed process/promise references are cleared (lines 227-251), but each task's `BoundedOutputBuffer` remains.
`jobs.list` and `jobs.inspect` intentionally expose that history (`src/tasks/job-service.ts:239-253`).
The reproduced ~27 MB for 25 maximally filled jobs is direct, high-confidence evidence. 1,000 such jobs is unusual but reachable through normal supported job usage, and long-lived sessions are an intended workflow.

This is reliability/resource hygiene, not a security boundary: execute code can consume memory itself.
Still, the parent retaining every completed payload after the producer exits is worth fixing.
The report over-prescribes “disk-backed inspection.” A global completed-output budget and eviction through the already-existing `outputLost` semantics preserves useful metadata with fewer new lifecycle problems.
Count-capping all job records is not justified by the evidence.
Metadata is much smaller and useful for IDs/status/history.

### Original transcript — POLICY, not an unconditional fix

The upstream `SessionManager` deliberately stores all parsed entries plus indexes in `fileEntries`/`byId` (dependency `session-manager.js:586-697`).
Compaction changes `buildContextEntries`, not the append-only source history.
Die's documented `history.search/read` explicitly searches the original active branch after compaction (`wisdom/history/searchable-history.md`), and branch/UI behavior also depends on originals.

A 32 MiB journal used about 32 MiB more heap. That shows the source stays in RAM. It does not show a leak or runaway growth. “Compaction is not RAM reclamation” is true. It does not prove a bug.
The main report's conditional wording—disk backing **if** very long sessions must have flat RAM—is the right qualification.
Before committing to a lazy journal/index, define whether sessions are expected to remain usable at tens/hundreds of MiB and collect real session-size/resume-memory data.
The size of the work is not why this should wait. The need is not proven, and branch and history rules are easy to break.

### Execute artifacts — separate capture safety from retention

`OutputCapture` starts durable spill above 4,000 decoded characters and then writes all subsequent bytes (`src/typescript/output-capture.ts:150-232`).
Returned paths are part of the result (lines 131-138).
Handles close correctly, so this is not an FD leak.
Execute code can already write files with no cap. So this is not a sandbox or security bug.
But the wrapper captures output on its own. One noisy log can fill the disk. A per-run cap protects even trusted code.

Cleanup over time needs a clear rule for user data. A size cap is not enough.
Session-backed files are evidence tied to an append-only session, and deleting them behind a still-valid returned path would be surprising.
On the other hand, no source lifecycle currently owns `<session>.jsonl.artifacts`.
Define user-visible cleanup/session-deletion behavior.
A global TTL or silent aggregate eviction is not justified until artifact durability expectations are set.

### Concurrent helpers — evidence is too weak for the broad recommendation

The bridge limits each frame to 1 MiB but has no in-flight count limit (`src/typescript/job-bridge.ts:49-50,300-332,606-629`), and `subagent.prompts` also has no item-count bound (`src/tasks/job-service.ts:19-25,161-206`).
So pressure is plausible.
But the audit gives no concurrency reproduction, realistic fan-out, retained-byte slope, or failure mode.
Bridge teardown aborts/releases request state.
Execute is explicitly arbitrary local code and can spawn processes or allocate memory without helpers, so “unbounded” alone is not enough to prove a bug.

Do not conflate this with the separately reproduced **sequential ACK-state retention**: 10,000 already-acknowledged calls retaining listeners/~5 MB until worker exit is a **FIX**, because observational calls have no result ownership to preserve.
That evidence does not prove a generic concurrency limit is needed.
For concurrency, first measure (a) many slow `jobs.list/history` calls and transport buffering, and (b) task/subagent fan-out.
If paid-provider/task fan-out needs a limit, set it as an explicit scheduling/cost policy (including the batch API), not as a claimed leak fix.

## Bottom line

First, bound total completed-output RAM and each execute capture. Also retire the ACK state we already proved stale.
Treat original-history residency and artifact lifetime as explicit product policies.
Keep generic helper concurrency as a measured follow-up not a confirmed resource defect.
