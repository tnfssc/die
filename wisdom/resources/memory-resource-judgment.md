> Historical v0.3.4 audit/decision record.
The selected v0.4.0 fixes and current policies are documented in [resource limits](./resource-limits.md) and [disk-backed history](../history/disk-backed-history.md).
Measurements below describe the pre-fix investigation unless stated otherwise.

# Which audit findings deserve action?

2026-09-18.
Judgment only.
No implementation authorized/applied.
Companion evidence: [audit](./memory-resource-audit.md).

## Standard

A fix is not wrong just because it is large.
Ask what normal work needs. Ask what harm users can see. Check who owns the resource, how strong the proof is, and whether the data must stay in that form.
A large set of useful data is not a leak.
Keeping the same data after its owner is done can be one.
A collection has no cap? That alone does not prove a bug.
Do not save memory by quietly breaking history, output order, task delivery, or locks.

Two independent reviewers examined intentional-history and lifecycle findings.
Their notes are in wisdom/resources/leak-audit-judgment-history.md and leak-audit-judgment-lifecycle.md.
They disagreed on some policy/defense-in-depth items.
The lead made the calls below. They are not a vote.

## Worth addressing in Die

| Area | Judgment | Reason / required outcome |
|---|---|---|
| Completed-job output RAM | **Yes, high practical value** | Legitimate repeated jobs retain large payloads after execution ends. A per-job cap is not a session memory budget. Bound aggregate resident output while retaining job identities/status and making output availability honest. Existing outputLost permits explicit eviction; disk-backed retrieval is appropriate if full retained inspection is desired, not automatically mandatory. |
| Terminal subscriber backlog | **Yes, high practical value** | A normal noisy command plus slow/suspended client is enough; no adversarial workload required. Bound memory attributable to each subscriber, without silently dropping ordered/control events or stalling every healthy subscriber. Add a real slow-client saturation reproduction as the acceptance test; current full-socket growth rate remains unmeasured. |
| Provider log sink/retention policy | **Yes, definite correctness fix** | Configured aggregate disk/age retention is defeated by obsolete active-file exemptions. This should work regardless of how many old threads the server has seen. Small sink RAM is secondary. |
| Execute acknowledged-request state | **Yes, definite cleanup fix** | Completed observational RPCs have no result-ownership reason to retain controllers/listeners. Release them without weakening foreground-task crash-safe ownership transfer. |
| POSIX web launcher termination | **Yes, failure containment** | Stop should have a bounded outcome and should not abandon launcher-owned child processes merely because the leader exited. Conditional backend misbehavior does not make the ownership contract unimportant. Do not touch unrelated process groups or claim Windows coverage. |
| Automatic execute output capture size | **Yes, explicit resource safety** | The application's automatic capture can fill disk due to an accidentally noisy log. Set a documented/configurable capture budget and clear limit/error/truncation reporting. This is not a sandbox/security boundary and is not grounds for arbitrary default execution timeouts. |
| Pi locks, syntax-language cache, PR prompt cache | **Yes, lower priority** | These have obsolete owners or redundant semantic keys. Retire locks only when no holder/waiter remains; canonicalize unsupported language keys; remove or bound obsolete draft prompt bodies. Expected impact is smaller than output/history. |
| Completed optional Pi-extension records | **Yes if maintaining the advertised extension compatibility path** | Finished records retain full descriptions across legitimate long sessions. This is not the capped default Die task projection. Preserve needed dedup evidence without retaining every full finished record. |
| Original transcript RAM | **Yes as a scalability improvement, not an established leak** | Lead's product judgment: long-running/resumable agent sessions are central enough that old durable text should not dictate the whole resident working set. Preserve full originals on disk and load/cache what is needed. The audit proves proportional residency, NOT current production OOM or pathological amplification. No emergency claim. |

### Why the transcript verdict differs from the skeptical reviewer

The history reviewer is right. This is a product rule, not a correctness bug. Keeping 32 MiB of source text in about 32 MiB of heap is no surprise. Compaction promises a smaller model context. It does not promise flat process memory.

Still, I would bound how much old history stays in RAM for long and resumed sessions.
It is not necessary to erase originals or force a new session.
That scale goal may justify a large history and index redesign. A false leak claim does not.
Before coding, set a RAM target and performance tests. Keep branch moves, stable refs, privacy and exclusion rules, and durable appends.
Do not promise infinite history on finite total storage.

## Needs an explicit product policy, not a guessed cleanup rule

- **Artifact lifetime / cumulative disk usage:** stored evidence consuming disk is legitimate.
  Provide discoverability, usage accounting, and explicit cleanup/session ownership.
  Do not silently expire artifacts that a valid retained session still references.
  A per-run capture limit and a cumulative retention policy are different decisions.
- **Active-job working memory/concurrency:** memory for work actually in progress is expected.
  Scheduling/resource budgets can limit parallelism but are not leak repairs.
  Do not impose a generic helper concurrency cap as a confirmed fix from the audit alone. First measure realistic fan-out, queues, and parent latency.
  Keep this separate from the proven sequential ACK retention bug.

## Do not prioritize as Die fixes now

- **Desktop recording timeout registration:** real correctness bug (late stale capture is worse than its small memory footprint), but unreachable in normal Die web. previewBridge resolves window.desktopBridge?.preview or null. startBrowserRecording rejects immediately with no bridge.
  Recommend upstream fix. Not a current Die CLI/web release blocker.
  Earlier advice putting this in Die's top five was overbroad.
- **Tiny navigation/error/favicon/icon sets:** no real impact measured. Typical number of keys is modest.
  Accept current behavior pending evidence rather than add eviction state everywhere.
- **Terminal internal processing queue, preview PubSub, VCS maps, successful preview host assignments:** source shapes justify targeted measurements, not blanket queue/cache rewrites.
  Their workload/rate/owner semantics differ from high-volume terminal subscriber buffering.
- **Windows process-tree handling:** not a current shipped-platform target here.
  Revisit with a Windows ownership design when supporting it.
- **RSS growth that settles/reclaims:** not a defect by itself.
  Mixed CLI RSS drift remains unresolved. Profile retained objects before treating it as a leak.
- **Old preview timeout allegation:** reject it. The current implementation disconnects and clears the queue.

## Priority order

1. Bound high-volume retained/completed job output and terminal subscriber memory. Restore provider log retention.
2. Repair request and shutdown ownership, and put explicit safety bounds on automatic output capture.
3. Make original-history RAM scalability an explicit architecture goal. Address lower-impact obsolete caches/extension records without breaking behavior.
4. Keep normal storage growth and genuinely active working memory. Measure the uncertain cases instead of manufacturing fixes.

We cannot promise endless saved data, fixed total storage, and no data loss at once.
We can keep RAM bounded and put durable history on disk.
Disk still fills. Users need a clear rule for what happens then.
