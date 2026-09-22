# T3 v2 production process-resource ownership

## Scope

Owned work only: `ProviderSessionManagerV2` release ownership plus the smallest adapter/PiRpc hard-stop surface. No queue/continuation, accounting, backend-policy, canonical export, or generic process sweeping changes.

## Implementation

- Added optional `ProviderAdapterV2SessionRuntime.hardStopOwnedProcess`. It is explicitly an emergency handle for a process/tree exclusively owned by that runtime and must operate independently of scope finalizer order.
- Pi runtime wires the handle to `PiRpcConnection.hardStop`.
- PiRpc keeps its existing bounded graceful `terminate` for normal scope finalization, and adds `hardStop`: exact captured child process group/tree termination followed by waiting on the captured `ChildProcess.exitCode` reap observation. It does not scan names, use a TTL broker, or kill unrelated processes. The exit-code effect is awaited to completion; signal termination is represented as failure by the process API but still constitutes an observed exit/reap.
- ProviderSessionManager now creates a release tombstone if scope close times out after removing a runtime from the live map. New opens of that provider-session id fail while ownership is unresolved. On scope-close timeout it invokes the captured owned-process hard stop outside the wedged scope, and only then writes released session/runtime-request events, revokes credentials, and removes the tombstone. If no hard-stop handle exists, it retains the tombstone and does not falsely publish/revoke on the assumption that the process exited.
- Normal scope-close success/failure marks ownership settled as before; release event/session semantics remain after actual teardown.

## Real process regression/probe

`ProviderSessionManager.test.ts` now launches five real detached PiRpc child process groups through the production PiRpc path. Each child reports its exact PID. The probe:

- uses a scoped HOME and XDG state directory created under `/var/tmp`, with child `TMPDIR=/var/tmp`;
- performs repeated manual/runtime-error releases and checks every exact PID is dead;
- wedges the finalizer registered ahead of PiRpc cleanup for the last process and ignores SIGTERM, forcing manager timeout -> out-of-scope hard stop -> SIGKILL/reap;
- checks all five PID identities are unique/dead and the parent `/proc/self/fd` count returns within a +2 observation allowance.

The existing synthetic hung-close test now asserts the hard-stop callback runs before the stopped projection is accepted.

## Validation

- Full ProviderSessionManager suite: **passed** (40/40), including the real process wedge/plateau probe.
- Server TypeScript check: no errors in ProviderSessionManager, ProviderAdapter, or PiRpc owned files. The workspace check still reports unrelated errors in concurrent production-candidate files.
- PiAdapter/PiRpc suite: **passed** (51/51) with `TMPDIR=/var/tmp`.

## Operational invariant

A release timeout is no longer treated as process cleanup. Released events and credential revocation happen only after ordinary scope close completes or the exact adapter-owned process handle confirms exit/reap. An unprovable cleanup remains tombstoned instead of becoming an invisible orphan.


## 2026-09-21 follow-up: native child provider retention

### Policy


`ProviderSessionManagerV2` now chooses the existing idle timer per live session. The production defaults are:

- trusted native Die roots (backend-issued `dieDelegation.depth === 0`): unchanged 30-minute idle retention;
- trusted native Die children (backend-issued `dieDelegation.depth > 0`): 5-second idle retention;
- all other providers/sessions: unchanged 30-minute idle retention;
- an explicit `idleTimeoutMs` layer option still overrides both defaults for focused tests.

The child classification is captured only from the manager's existing backend derivation: Die-owned binary mode, Pi instance, persisted subagent lineage, and the persisted marked parent edge. Provider input cannot request the short class. The timeout is a field on the existing live-session entry and uses the existing generation/busy-count/idle-fiber/release path. Pending adapter background work still pins release, subject to the existing 4-hour maximum pin. This change does not cancel a run, descendant, continuation, task graph, or durable history; after provider release, later work can lazily reopen from durable provider/Pi state. No TTL broker or second timer subsystem was added.

### Process evidence

Focused production-default process test: `ProviderSessionManager.test.ts`, “production-default Die children release exact owned PIDs while the root stays warm”. It creates durable root→child task edges, enables the trusted Die backend identity, opens one root plus five child sessions through the production manager, and gives every runtime a real owned Node process. No explicit child release and no short test idle override are used. At 4,999 ms each exact child PID is alive; after the production 5,000 ms idle boundary it is dead and its provider entry is absent. The root PID/session remains live through the bounded post-idle observation, then is explicitly released by test cleanup. TMPDIR and HOME/state are isolated under `/var/tmp`; no user state is used.

Observed rerun (`--disableConsoleIntercept`), fields are `cycle / live child provider entries / live child PIDs / self fds / self RSS bytes`:

- 1 / 0 / 0 / 23 / 295,411,712
- 2 / 0 / 0 / 23 / 300,785,664
- 3 / 0 / 0 / 23 / 302,620,672
- 4 / 0 / 0 / 23 / 304,586,752
- 5 / 0 / 0 / 23 / 306,683,904
- bounded post-idle / 0 / 0 / 23 / 306,683,904

The preserved five-cycle wedged-finalizer probe also now records its own bounded samples. Its rerun reported live owned PIDs 0 and fds 23 for cycles 1–5 and post-idle; RSS samples were 295,419,904, 299,069,440, 300,511,232, 302,346,240, 304,312,320, and post-idle 304,312,320 bytes. The fifth cycle still exercises the exact-PID hard-stop fallback after the bounded close timeout.

These are per-cycle resource samples, not a zero-leak claim. Exact owned PIDs, live manager entries, and fd counts reached the demonstrated plateau. RSS rose by about 11.3 MiB across this short run and was intentionally reported without a flat-RSS assertion; allocator/JIT RSS is supporting context, not the leak verdict.

Validation:

- focused production-default child process test: 1 passed (39 skipped);
- full `ProviderSessionManager.test.ts`: 41 passed;
- server `typecheck`: exit 0 (existing Effect suggestions only).
