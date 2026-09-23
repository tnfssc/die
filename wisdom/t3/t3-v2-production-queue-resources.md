# T3 v2 production queue/resource ownership

## Source confirmation

Before changing the candidate, read `wisdom/t3/t3-v2-production-resource-review.md`. Its reachable hazards were present in `.cache/die-t3code-v2-production`: unbounded Pi RPC event/write queues, unbounded terminal PTY callback backlog, unbounded continuation requests plus one retry fiber per failed delegated completion, and unbounded live provider-event subscriber queues. The actual Pi transport is `apps/server/src/orchestration-v2/Adapters/PiRpc.ts` (not `provider/Services/PiRpcClient.ts`).

## Implemented in candidate

- **PiRpc**: incoming events are bounded at 256 and backpressure the stdout reader; outgoing frames are bounded at 32 and backpressure senders; correlated requests are capped at 128 with a semaphore. Outgoing JSONL records above 8 MiB fail explicitly. Transport failure fails both bounded queues and pending requests.
- **Provider event subscribers**: per-subscriber queues are dropping/bounded at 256 only as an overflow detector. Overflow clears and fails that slow subscription, removes its registration, and does not stall healthy subscribers. Provider terminal failure clears saturated queues before enqueueing the failure signal.
- **Terminal RPC subscribers**: new shared helper bounds each registration at 32 events and 64 MiB serialized data. Overflow unregisters and fails the slow stream; clients already reconnect terminal attach/events and obtain a fresh bounded history snapshot. Registration release is idempotent.
- **Terminal PTY producer backlog**: manager backlog is capped at 256 callbacks / 8 MiB. Since node-pty callbacks cannot backpressure, overflow uses explicit in-band truncation semantics: queued output becomes a truncation marker plus the newest byte-bounded tail. Exit remains retained. Byte accounting is decremented/reset on drain and every lifecycle reset.
- **Continuation reactor**: resident request queue is bounded at 256 and offers backpressure producers. Delegated completion is durable in thread projection while blocked. Retry no longer forks one sleeper per failure. The single scoped worker retries one durable request with existing capped exponential delay and rechecks current projection ownership before dispatch. This bounds sleeping retry fibers and in-memory retry state.

PiAdapterV2 model/usage policy was not changed. ProviderSessionManager release/hard-stop edits already present from the other worker were preserved; my hunks there are limited to provider-event subscriber queues.

## Checks run (TMPDIR=/var/tmp for test/typecheck commands)

- terminal subscriber + continuation focused suites: **22 passed**.
- terminal manager suite before the added overflow case: **83 passed**. The focused producer-overflow/truncation-marker case then passed independently.
- ProviderSessionManager suite: **38 passed, 2 failed**. Both failures are in concurrent hard-stop/idle-release work (missing ChildProcessSpawner service and a timeout), not the subscriber overflow path.
- Pi provider transport smoke suite: **2 passed**. The monolithic PiAdapterV2 suite produced no per-test result before the 180s command timeout. This is recorded as inconclusive, not a pass (and PiAdapterV2 itself was not changed).
- server tsc reached concurrent hard-stop test/type mismatches in ProviderSessionManager (including `hardStopOwnedProcess` absent from the runtime contract). No diagnostic named the queue/resource files changed here.
- `git diff --check` passed for the scoped files.

The repeated subscriber lifecycle test runs 100 subscribe/deliver/close cycles. After each cycle, it checks that registration count returns to zero. These focused tests show only bounded queue/listener behavior. They do not make a broad zero-leak or whole-process FD claim. These changes add no FD-owning primitive.

## Head-of-line / PiRpc saturation follow-up

- **Continuation retry topology:** fresh continuations and retries now have separate scoped workers. The retry side is one shared FIFO of **256** records, one retry worker, and at most **one sleeping retry timer**. No delivery failure forks a fiber. Together with the existing fresh-request capacity of **256**, resident scheduler state is bounded to 256 fresh queued + at most 256 retries total (queued plus one active) + one active fresh. A fixed 256-token admission queue reserves the active retry's re-enqueue slot, preventing scheduler self-deadlock. The retry-attempt map is bounded by retry identities to at most **256**. Backoff is 100 ms exponential, capped at **5,000 ms**, with no attempt-count cutoff. A failed retry goes to the queue tail, so one permanently failing delivery cannot monopolize the scheduler. Fresh healthy child completions are attempted by the independent worker without waiting for retry sleep.
- **Retry failure semantics:** when all 256 retry slots are occupied, the fresh worker backpressures while admitting another failed durable completion, and the existing 256-slot request queue then backpressures producers. The thread projection remains authoritative; retry memory is not treated as delivery ownership. Restart/replay reconstructs an open delivery with the same identity. Archive/delete/dispose or a superseding projection clears the retry. Dispatch/projection failures are logged and retried indefinitely at the capped delay; there is no silent success or finite-attempt drop.
- **PiRpc reader semantics:** unsolicited events are held in a nonblocking dropping queue of **256**, but overflow is not treated as a dropped event: the first refused offer explicitly fails the whole PiRpc session with `PiRpcError(read, "event queue exceeded 256 records")`, fails all correlated requests, and closes both queues. This allows a correlated `request`/`get_state` response immediately behind exactly 256 unsolicited records to be read and completed instead of deadlocking. Existing bounds remain **32** outgoing frames, **128** concurrent correlated requests, and **8 MiB** per JSONL record.
- **Focused tests:** a permanent delegated-transfer failure plus healthy delegated sibling proves prompt healthy dispatch, retained shared retry, and successful replay from the durable projection. PiRpc tests prove a response behind a full 256-event queue completes and the 257th unsolicited event fails the session explicitly.

These are bounded scheduler/queue assertions, not a zero-leak or whole-process resource claim.
