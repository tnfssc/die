# Lifecycle/resource audit judgment

Date: 2026-09-18

## Scope and standard

I independently reviewed `wisdom/resources/memory-resource-audit.md`, `wisdom/resources/leak-audit-current-web.md`, and the execution note (present as `wisdom/resources/leak-audit-execution.md`), then checked the cited source. This is a disposition, not an implementation plan. “FIX” means the current behavior violates a useful lifecycle/resource invariant with enough confidence to act. “ACCEPT” means the retention is currently proportionate or only becomes relevant under contrived cardinality. “NEED EVIDENCE” means bounding it could change behavior and the audit has not shown practical pressure.

Change size is not a reason to defer. Conversely, the mere presence of a process-lifetime Map or unbounded Effect primitive is not by itself a defect.

## Decisions

| Area | Judgment | Practical severity | Why |
|---|---|---:|---|
| Terminal stream queue per connected subscriber | **FIX** | High under overload | A normal noisy terminal plus a slow, suspended, or non-ACKing web client is credible routine usage. `Stream.callback` is unbounded upstream of the 8-chunk/64 KiB ACK window, so that window gives a false boundedness guarantee. No malicious code is required; `yes`, a large build, or poor connectivity is enough. Quiet reconnect tests do not exercise this. |
| Terminal manager's internal `pendingProcessEvents` | **NEED EVIDENCE** | Unknown | The source has an unbounded array, but the audit did not establish that normal history/event draining can remain slower than PTY output long enough to grow materially. An arbitrary cap risks dropping ordered output or an exit event. Measure queue depth and retained bytes under sustained output and slow persistence first. |
| Preview unbounded PubSub | **NEED EVIDENCE** | Low/unknown | A live stalled subscriber can lag, but preview event rates are unlike PTY byte rates and departed subscribers are scope-cleaned. Show a realistic stalled consumer and growth slope before changing delivery semantics. This is not a post-disconnect leak. |
| Execute bridge concurrent request cardinality | **FIX**, defense in depth | Medium conditional | This is parent-process pressure, not retained leakage after execute. The producer is arbitrary execute code, so it should not be described as a routine ambient leak or a security boundary. Still, the bridge is the privileged crossing into the long-lived parent; accidental large `Promise.all` batches should receive a finite concurrency/backpressure policy rather than allocate without limit. |
| Provider event-log sinks / aggregate retention | **FIX** | Medium disk, low memory | The reproduction proves the configured 1,024-byte aggregate policy can retain 110,890 bytes across 100 thread files. The sinks hold metadata rather than FDs, but every historical sink marks its file active forever. This is primarily a disk-policy correctness bug. It matters only when provider event logging is enabled, but many normal threads over a long-lived server are credible. |
| Web launcher termination on POSIX | **FIX** | Medium/high conditional | Normal exits are clean, so this is not a general launcher leak. Still, the normal embedded `die web` path also goes through `runExternal`; this is not merely the `DIE_WEB_SERVER` development override. Ctrl-C/TERM can hang forever if the backend ignores the signal, and leader exit can orphan owned descendants. Those are deterministic termination-contract failures. |
| Web launcher descendant guarantee on Windows | **NEED EVIDENCE** | Unknown/lower current relevance | POSIX process groups do not solve Windows. Before promising tree cleanup there, establish supported release expectations and use an ownership primitive such as a Job Object. Do not emulate tree killing by process-name or broad enumeration. |
| Failed desktop recording native-capture registration | **FIX** | Medium-low scope; meaningful correctness | This is dynamically reproduced and desktop-only, not a CLI/browser-server leak. A failed start leaves a callback/promise graph registered and, more importantly, a late trigger can start stale capture work after failure was reported. The stale side effect makes this worth fixing even if retained RAM is small. |
| Execute ACK/request/listener retention | **FIX selectively** | Medium for long single executes | The 10,000-call reproduction is specifically sequential `jobs.list()` over one execute: about 5 MiB and 10,000 cancellation listeners, all released at bridge close. It is not a cross-execute leak, and reaching that count usually requires deliberate or polling-heavy arbitrary code. But observational and failed RPCs have no result-ownership reason to survive ACK, so their retention is unnecessary. Task-owning foreground results have a real crash/notification semantic and must not be “fixed” by committing ownership at ACK alone. |
| Pi keyed thread locks | **FIX**, low priority | Low per key, unbounded cardinality | Retention was reproduced after both rejected starts and successful start/stop cycles while sessions and leases returned to zero. Real users create many threads over a server lifetime; arbitrary invalid IDs can accelerate it but are not the sole path. The entry's lifetime should follow users/waiters of the lock, not the adapter process. |
| Terminal/Cursor/VCS keyed locks | **NEED EVIDENCE** | Low/unknown | They are source-confirmed process-lifetime key maps, but only Pi has direct lifecycle/cardinality evidence. Terminal unknown-ID operations and provider calls may make the same bug likely; VCS cwd keys are usually naturally small. Instrument cardinality and distinguish valid resource identities from invalid caller-supplied keys before assigning material severity. A shared proven keyed-lock abstraction would change this judgment for free, but naive deletion is unsafe. |
| Pi extension subagent task records | **FIX**, low priority | Low to medium in long extension sessions | 100→200→300 completed records across drained turns is reproduced. This is not the default Die task projection (which is capped at 50), but it is a supported compatibility path and can grow in a legitimate long session. Completed-record deduplication may be needed, but full records should not remain until session stop without a bound. |
| Syntax-highlighter cache keyed by raw language labels | **FIX**, low priority | Low | Model/user Markdown can generate arbitrary labels during routine use. Unsupported labels all resolve to the same text behavior but retain distinct raw keys, so the cache key does not represent semantic identity. This is a clear finite-domain invariant even though each entry is tiny and no heap slope was measured. |
| PR handoff prompt cache | **FIX**, low priority | Low/medium conditional | Full prompt strings, rather than tiny metadata, are retained once per draft with no deletion. Material growth requires many PR handoffs in one tab, but that is legitimate usage. Tie retention to draft lifecycle or a bounded recent set; do not retain all historical prompt bodies for page lifetime. |
| Small navigation/error/favicon/icon caches | **ACCEPT** | Low | Current evidence is only source-level process/tab-lifetime sets of small strings, numbers, and booleans. Typical cardinality follows projects, worktrees, hosts, and dismissed errors. Content-controlled keys make adversarial growth possible, but this UI is not a hostile multi-tenant parser and the audit measured no practical slope. Revisit with browser heap/cardinality data; do not label these leaks now. |
| Successful preview host assignments | **NEED EVIDENCE** | Low | Records survive provider-session end until the desktop host disconnects, so lifecycle alignment is imperfect. They are small source-only records and need many sessions under one unusually long host connection to matter. Confirm cardinality and whether assignment reuse is semantically required before adding a session-ended hook. |

## Safest invariants to restore

### Terminal and producer backpressure

For each live terminal subscriber, bytes retained on its behalf must have a finite budget. The downstream ACK window and the upstream producer queue must compose into one bounded system. When a subscriber exceeds the budget, disconnect that subscriber (or explicitly mark a truncation/gap and require replay from bounded terminal history). Never silently hold unlimited bytes, and do not block history/other healthy subscribers behind one slow client. Preserve output ordering and ensure exit/control events cannot be dropped behind discarded data.

For the manager's internal event queue and preview PubSub, first measure. If bounding becomes necessary, define loss/replay semantics before selecting a queue size.

### Provider logs

`maxTotalBytes` and age retention must apply to files belonging to threads that are no longer actively being written. “Active” may protect a path only for the bounded duration of an actual drain/write, not for the server lifetime merely because a sink object once existed. After a drain/retention pass, any allowed overshoot should be clearly bounded (for example by one current rotated file), and future writes must recreate a deleted path safely. A thread-ended or idle-retirement API is useful, but correctness of aggregate retention must not depend on every provider perfectly emitting thread-end.

### Web launcher

On POSIX, the launcher must own a newly created process group, forward the user's signal only to that owned group, escalate after a bounded grace period, and perform final owned-group cleanup even when the leader exits first. It must remove signal listeners exactly once and preserve signal-derived CLI status (130/143) rather than reporting a backend's trap-and-exit-0 as successful user completion. Never signal the launcher's own or an unrelated process group. Treat Windows as a separate ownership design, not a weak approximation.

### Desktop recording

Once a capture registration is prepared, exactly one terminal path must consume or cancel that exact registration. Timeout, native-start failure, cancellation, and failed cleanup must leave no map entry. Identity-check deletion so an old cleanup cannot remove a newer registration for the same tab. After failure is reported, a late global trigger must return false and must not initiate `getDisplayMedia` or other stale work.

### Execute ACK lifecycle

Separate transport lifetime from result-ownership lifetime:

1. A request's parser/controller/composed cancellation listeners end on terminal response delivery, failure, disconnect, or cancellation.
2. Observational calls such as `jobs.list` and calls with no foreground task result retain no state after ACK.
3. A successfully returned foreground job result may leave only a minimal explicit ownership-commit record until the execute worker exits cleanly.
4. Worker crash/disconnect before clean exit must still restore exactly-once session completion notification; ACK alone must not swallow it.
5. Bridge close clears every remaining record.

This keeps the current valuable crash semantics without retaining generic RPC state for every call.

### Keyed locks and small caches

A keyed lock may be removed only when the registry still points to that same lock and it has no holder or waiter. Use lease/reference-counted ownership around acquisition. Deleting after one operation without accounting for queued entrants can create two locks for one key and break serialization.

Extension-task retention should keep only what is required to suppress duplicate events or represent live tasks, with a finite completed-task history. Syntax highlighting should canonicalize unsupported labels to one semantic fallback key (and keep the finite supported-language domain). Prompt deduplication should use a digest or lifecycle-bound recent entry rather than all full historical strings.

## Severity corrections

- The strongest routine resource risk in this set is terminal output versus a stalled live client, despite lacking a full-socket retained-byte reproduction. Its mechanism and workload are direct.
- Provider logging is a material retention-policy failure, but not an FD leak and not relevant when event logging is disabled.
- Launcher cleanup is a termination guarantee, not evidence that normal web shutdown leaks. Its impact is high when triggered because it can hang the CLI or orphan a backend descendant.
- Failed recording is narrow and desktop-specific, but stale capture behavior raises it above a cosmetic tiny-map issue.
- Pi locks, syntax labels, and most caches should not be described with headline leak severity. Some still deserve fixes because their semantic lifetime is plainly wrong; the remaining tiny caches need evidence, not blanket caps.
- Execute ACK retention is bounded by one execute's lifetime. Arbitrary code can intentionally amplify it, but the persuasive case is unnecessary retention for acknowledged observational calls, not hostile-code resistance.

## Recommended order

1. Bound terminal subscriber buffering with explicit lag/replay semantics.
2. Restore POSIX launcher process-tree ownership and termination escalation.
3. Make provider aggregate retention effective across historical thread files.
4. Remove failed desktop capture registrations on every failed-start path.
5. Split execute transport state from the minimal foreground-result commit state.
6. Retire Pi keyed locks and completed extension-task records safely.
7. Canonicalize syntax keys and lifecycle-bound full PR handoff prompts.
8. Gather evidence for terminal internal drain backlog, preview PubSub, other keyed-lock maps, preview assignments, and tiny UI caches.
