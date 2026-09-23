# T3 v2 shell/provider stream review

Date: 2026-09-21

## Verdict

**The preserved acceptance artifact does not prove a production stream bug, so candidate source needs no fix.** The reported `ProviderAdapterEventStreamError: Provider event stream ended unexpectedly` is absent from the preserved JSON proof, including its page snapshots and captured server output. The proof also predates the completed-shell timeline fix being ready for export. The recorded normal shell turn settled successfully. Its missing card came from the separately diagnosed historical-grouping bug.

No candidate production source was edited.

## Artifact chronology and recorded behavior

- `artifacts/t3-v2-preservation-acceptance.json`: 08:31:31Z, executable/patch `f666b8…` / `17c685…`.
- Shell-card fix was subsequently recorded ready for export in `wisdom/t3/t3-v2-production-design.md` and `t3-v2-shell-card-fix.md`. It preserves Pi/Die shell lifecycle entries as a historical grouping barrier and corrects the expected terminal label to `Ran printf`.
- The preserved proof records requests `complete-tool, complete-settled, complete-settled, pending-tool`. The second settled request is consistent with the designed completion wake: execute first returns the still-running background job, then completion wakes Pi and causes another model pass. It is not evidence that the provider stream ended.
- The final visible text shows the completed turn as `Worked for 1.9s` plus `PRESERVE_COMPLETE_SETTLED`, not a failed turn. The old proof failed because it could not find the completed shell lifecycle card/output after timeline grouping.
- Searching every string in the JSON proof finds no `ProviderAdapterEventStreamError`. Captured `serverOutput` likewise has no provider-stream failure. Thus the acceptance note's extra sentence is not backed by its attached artifact and should not be promoted into a second release blocker without a fresh reproduction.
- Harness teardown occurs only in `finally` after browser close/proof capture, where it SIGTERMs the whole backend process group. Such teardown can naturally close Pi stdout, but it cannot explain a failure absent from the already-captured artifact. If the sentence came from later console observation, it is teardown noise rather than evidence about the normal turn.

## Current lifecycle audit

Current candidate source reviewed:

- `apps/server/src/orchestration-v2/Adapters/PiRpc.ts`
  - unsolicited Pi events use a bounded dropping queue;
  - refusal explicitly fails the transport with the queue-capacity diagnosis;
  - stdout EOF explicitly fails transport with exit-code/unexplained-close diagnosis;
  - transport failure fails pending requests and both queues. It is not silently ignored.
- `apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts`
  - the adapter pump blocks on `Queue.take(connection.events)` and only terminates when the RPC queue ends/fails;
  - unexpected transport death fails the adapter event queue after finalizing an active turn as transport failure;
  - intentional restart/stop sets `stopRequested`, publishes provider status `stopped`, then ends the adapter queue cleanly.
- `apps/server/src/orchestration-v2/ProviderSessionManager.ts`
  - per-run subscribers are bounded dropping queues and overflowed subscribers are explicitly failed/removed;
  - the sole shared provider event pump treats clean completion as graceful only after observing provider status `stopped`;
  - every other clean end is converted to exactly `Provider event stream ended unexpectedly.`, published to subscribers, and the runtime is released;
  - so weakening/ignoring this error would mask real provider death and is not an acceptable fix.

These boundaries compose correctly: normal settled turns do not close any of these streams; explicit provider stop drains gracefully; real EOF/overflow fails visibly.

## Validation

Exact successful command:

```sh
TMPDIR=/var/tmp bun run --cwd .cache/die-t3code-v2-production/apps/server test -- src/orchestration-v2/Adapters/PiAdapterV2.test.ts src/orchestration-v2/ProviderSessionManager.test.ts
```

Result: **2 files passed, 95 tests passed**, including owned-shell settlement, command-only settle probes, stop/restart, Pi EOF/exit diagnosis, graceful subscriber drain, and provider event-stream failure release.

## Recommendation

Rerun preservation acceptance only against the post-shell-card rebuilt binary. Treat a stream error as a product bug only if the fresh proof captures it before harness teardown (page text/event projection or server output), ideally with Pi exit/EOF diagnosis. Do not suppress `ProviderAdapterEventStreamError` and do not widen queue/resource bounds.


## Superseding definitive reproduction — 2026-09-21 08:52Z evidence

The earlier conclusion above is superseded. The authoritative evidence is the acceptance run produced at design review 08:52Z: `artifacts/t3-v2-preservation-acceptance.json` for executable SHA-256 `bb4238757ef75eb4eb75142433f805cfb54865864de90403c8fb05510735717a`, plus `/var/tmp/t3-final-preservation-acceptance.log`. I independently reproduced it at `2026-09-21T08:55:13.054Z` with the requested environment; retained state is `/var/tmp/die-t3-v2-preservation-bMAzVL`.

### Actual cause

This was not teardown noise and not an EOF policy defect. SQLite projection evidence in the retained run makes the ordering definitive:

- run 1 completed at `08:55:34.693Z` after the completed shell card became `Ran printf`;
- a second user run was requested at `08:55:34.988Z`;
- between those, provider-session event sequence 53 at `08:55:34.898Z` changed the session to error with `Pi started agent work outside an active T3 turn...`;
- the second run then failed at `08:55:35.901Z`, followed by the visible unexpected-event-stream-end projection.

The 250 ms offset identifies the race. `src/tasks/extension.ts` queues completed-job notifications in a 250 ms `CompletionBatcher`. Its `agent_end` hook synchronously flushed the batch only in print/json mode, not RPC mode. In this run the local shell completed immediately before RPC `agent_end`; Pi settled the owned T3 turn, then the debounce timer delivered `sendMessage(..., { deliverAs: "steer", triggerTurn: true })`. That began agent work after the adapter had cleared its active turn. The Pi V2 adapter correctly treated that as unowned activity and terminated the process. The manager then correctly reported unexpected EOF. The later user turn just collided with this already-triggered shutdown.

### Production fix

`src/tasks/extension.ts` now flushes queued completion notifications synchronously from RPC `agent_end` before returning. So the native Pi steer is queued while the active T3 turn still owns it. It cannot escape from the debounce timer after settlement. Print/json waiting behavior is unchanged, and EOF/unowned-activity failures remain strict.

Regression `rpc agent_end flushes an already-completed job before Pi settles` in `tests/subagent-extension.test.ts` starts a background shell, observes completion while the debounce batch is still pending, fires RPC `agent_end`, and proves the task-complete steer is emitted synchronously.

Checks:

`bun test tests/subagent-extension.test.ts` — **23 passed, 0 failed**.

Coordinator must rebuild the executable before rerunning preservation acceptance. The old `bb423875...` binary necessarily still reproduces the race.

## 09:15Z final live rerun supersedes unit-fix claim
Newroot executable9fde1b1d90a54555c65d161414bb4c4c588ac688b82adbae0d9f3a4ab0660196 still fails preservation: secondturn ProviderAdapterEventStreamError after completedlocalshell. Synchronous RPCagent_end batchflush alone INSUFFICIENT. Native/browser/packagedsecurity allPASS samehash. Canonical NOTadopted. Finalnote t3-v2-production-final.md captures blocker. No broad productionreadiness claim.
