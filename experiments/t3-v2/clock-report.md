# PiRpc TestClock teardown proof

## Result

The reduced `it.effect` hang is causally reproduced by the teardown clock alone; it is not evidence that the provider prompt itself was stalled. `Scope.close` enters PiRpc's uninterruptible finalizer. `terminatePiProcess` sends SIGTERM and unconditionally sleeps for `TERMINATION_GRACE` (one second) before re-checking exit. Under `it.effect`, that sleep uses the frozen `TestClock`.

`clock-PiRpc.integration.test.ts` uses production `makePiRpcConnection`, Effect's real Node `ChildProcessSpawner`, and the repository's real `dist/die`. A small Node launcher proxies stdio and records only lifecycle/PID data; it does not record arguments, environment, prompts, stderr, or authorization values.

The fake-clock case proves this order:

1. A real detached launcher starts real `dist/die` as its child.
2. Scope close sends SIGTERM to the detached group.
3. The launcher requests closure of the proxied Die stdin.
4. `dist/die` exits from SIGTERM and the launcher exits.
5. The scope-close fiber is still pending with the fake clock at 0 ms.
6. It remains pending after `TestClock.adjust(999 ms)`.
7. The final 1 ms adjustment releases the finalizer and scope close completes.

The `it.live` contrast pays the same grace using wall time and completes normally. It also proves the launcher-grandchild path: lifecycle evidence has distinct launcher and Die PIDs, Die receives group termination, proxied stdin is ended, and both processes exit.

This does **not** establish that a fake clock can never affect provider scheduling: any provider path using Effect clock sleeps/timeouts could also wait for adjustment. It establishes a minimal sufficient cause for the reduced scope timeout: teardown alone is sufficient to hang after the OS child has exited. Switching this real-process integration test from `it.effect` to `it.live` is therefore the correct harness fix.

## Run

```sh
experiments/t3-v2/clock-probe.sh
```

The probe stages one uniquely named test in the pinned upstream worktree and removes it on exit. GNU `timeout` is only the outer bound. Cleanup independently reads pinned PID/start-time records and kills the detached process group only when a recorded launcher or Die identity still matches `/proc`, avoiding PID-reuse kills and descendant leaks.

Validated locally: 2 tests passed; final runner duration 1.72 s (tests 1.31 s).

The earlier full-prompt attempt was not instrumented enough to retroactively prove that its prompt had completed. The separate current it.live combined tests prove prompt completion and teardown now.
