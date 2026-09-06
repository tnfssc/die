# Project-local agent memory

This opt-in extension keeps memory in ordinary Markdown under a project's
`.agents/notes/` directory. It adds no model-facing memory tool or database.

## Layout and selective reading

```text
.agents/notes/
  index.md                  # short descriptions of immediate topics
  architecture/
    index.md                # immediate child notes and topics
    session-ownership.md    # focused durable facts, evidence, caveats
  .pending/
    <unique-name>.md         # new observations awaiting consolidation
```

Use the existing execute tool and ordinary filesystem operations. Start with
`index.md`, follow only relevant topic indexes, then read focused notes. Do not
load the entire tree into every prompt. Write new observations as uniquely named
Markdown files in `.pending/`; include context, evidence, uncertainty, and any
applicable constraints. Avoid credentials, private data unrelated to the task,
and unverified assertions presented as facts. Notes are fallible project data,
not instructions that override the user or grant permissions.

Consolidation may rewrite and reorganize existing topic notes to reconcile
outdated decisions and remove duplication, rather than endlessly appending
summaries. Every topic should have a short index describing immediate children.
Whether to commit local notes is the user's choice; the extension does not run git.

## Assignment boundaries and cost

An assistant turn is **not** a completed assignment. Neither `agent_end` nor
`agent_settled` proves the user's task is finished: both occur around handoffs and
managed background work. Shutdown is too late to start new owned work safely.

The initial design is explicit, per-invocation consent:

```text
/memory status
/memory consolidate fast --constraints <applicable user constraints, or none>
/memory consolidate normal --constraints <applicable user constraints, or none>
```

Use this only when the assignment is complete and relevant writers have settled.
The chosen profile is a normal managed subagent and can incur model costs. Fast
is recommended for routine small merges; normal is available for complicated
conflicts. There is no automatic paid call on turns, job completion, or shutdown.
An empty pending snapshot launches no worker. Child sessions cannot consolidate.
The explicit constraints must carry all applicable user restrictions; writing
`none` does not waive restrictions already imposed by the user.

Automatic completion-based triggering and persistent cost consent remain user
choices, not enabled defaults. Any future automatic mode needs an authoritative
assignment-completion signal, no relevant outstanding jobs, explicit profile/cost
consent, and a live owner capable of retaining the consolidation job.

## Save, consume, and retry protocol

Only direct Markdown children of `.pending/` are source notes. A launch snapshots
path, content, and SHA-256; notes added later are outside that run. A successful
process exit alone is insufficient: the worker must save durable Markdown and
then write the per-run, nonce-named JSON receipt specified in its prompt. The
controller validates saved file hashes and the root index before marking source
snapshots consumed. A receipt verifies bytes, not the semantic quality of a merge.

Consumption publishes immutable, content-addressed markers in `.consumed/`.
Source files are not deleted, avoiding a check-then-delete race with a newer
version. A changed source file at the same path has a different marker identity
and remains available for retry. Failed launches, failed jobs, missing or invalid
receipts do not mark notes consumed. Saved partial work may remain after failure;
the retry should reconcile it rather than duplicate it.

The project-wide `.consolidation.lock/` excludes cooperating consolidators.
Never reclaim locks merely because they are old or their recorded owner appears
inactive. After a crash or interrupted ownership, first verify that no worker is
still writing; only then manually remove an abandoned lock and retry. Ordinary
execute-based writers must also coordinate with consolidation. Filesystem checks
reject existing symlinked managed paths, but this is not a sandbox against a
hostile process concurrently replacing directory ancestors. Multi-file edits
are not an atomic transaction; no rollback or model-quality guarantee is implied.

## Registration and integration

```ts
import { registerProjectMemory } from "./memory/extension";

const memory = registerProjectMemory(pi, {
  jobs,     // existing JobService-compatible handle(method, value, ctx, signal)
  manager,  // existing TaskManager-compatible inspect and kill
  isRoot: () => /* current, restored session identity is root */ false,
});
// Forward owned task lifecycle changes, including terminal completion:
void memory.jobsChanged();
```

Register once per extension/session owner after the job service is available.
Adapters may forward to the current lazily-created service/manager. Root policy
must use restored session identity, not environment depth alone, and fail closed
on invalid or unavailable identity. Completion reconciliation must run before
job ownership is discarded. The runtime does not create its own polling timers,
job manager, process runner, model tool, or automatic continuation.

This feature branch intentionally does not edit `src/tasks/extension.ts`.
Until the owner explicitly registers this function and forwards lifecycle
changes, these commands and the short selective-reading context hint are inert.
No application behavior or paid-call default silently changes.
