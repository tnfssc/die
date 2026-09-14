# Independent runtime recheck

## Verdict

At the final snapshot below, **all 11 black-box runtime scenarios pass** on both 'godie/bin/godie' and a separately built review executable. The two executables are byte-identical. No current runtime failure was reproduced.

This is a recheck of runtime findings in [code-review.md](./code-review.md), not a provider/live test. The original 'bin/die-original' has no direct '--execute' entry point, so executable differential results against it are explicitly **blocked/untested** below.

## Snapshot

Final checks completed 2026-09-13 20:29 UTC. Repository HEAD was '14981b44d68988261dbe056227c952671963c838'.

| item | SHA-256 | mtime (UTC) |
|---|---|---|
| 'godie/bin/godie' | 'd99aaefa5c9ffa8c09e7c8fb7549bdb11003e9294696e3a2da4bdd2af801d8e8' | 2026-09-13 20:28:20 |
| 'validation/artifacts/godie-review' | 'd99aaefa5c9ffa8c09e7c8fb7549bdb11003e9294696e3a2da4bdd2af801d8e8' | 2026-09-13 20:28:26 |
| 'godie/bin/die-original' | '9db13b557954004a3b3e6f8cde3ce8a18ade8e99376b730e9be88f635e900c39' | 2026-09-13 19:52:35 |

The review build was made without replacing 'bin/godie':

    cd godie
    go build -o validation/artifacts/godie-review ./cmd/godie

Runtime source hashes at build/recheck were:

- 'internal/runtime/execute.go': 'bfd863bbd9972749d774c5d4bb56db74e16d92f3dff4c710ef652a54101cae97'
- 'internal/runtime/jobs.go': '28ca1195340eff14eeac30d9c308e032f12d752e2a4555dc0aaf50af2fa233c6'
- 'internal/runtime/assets/runner.js': '81d6f82ff99c881263790eacb0e69630994745ede3ec8dbd5ec3ea82649463c4'

The binary changed during active implementation while this review was running; final runs were repeated after the 20:28 rebuild and this report refers only to that final binary.

## Method and process safety

Harness: [runtime-recheck.py](./runtime-recheck.py).

Final commands:

    cd godie
    python3 validation/runtime-recheck.py bin/godie validation/artifacts/runtime-recheck-bin
    python3 validation/runtime-recheck.py validation/artifacts/godie-review validation/artifacts/runtime-recheck-source
    go test -race ./internal/runtime

Both harness invocations exited 0. The race suite passed: 'ok godie/internal/runtime 16.678s'.

Every black-box scenario used a fresh temporary HOME, state directory, working directory, and TMPDIR. API-key-shaped environment variables were removed; '--offline' was supplied; there were no provider calls or credentials. Tests invoke the real executable and bundled Bun worker.

The harness never uses 'pgrep', 'pkill', or name/pattern kills. Each CLI is started in a new session. Test jobs write their exact PID to a harness-owned unique pidfile. Cleanup checks the PID's Linux start-time identity and signals only that exact process group, or the exact CLI process group created by 'Popen(start_new_session=True)'. No unrelated process groups are targeted.

Raw stdout/stderr and manifests are under:

- 'validation/artifacts/runtime-recheck-bin/'
- 'validation/artifacts/runtime-recheck-source/'

## Results

Timings below are from a representative final run; the source-built executable produced the same outcomes.

| Review concern / scenario | Status | Evidence |
|---|---|---|
| P0 blocked stdin write versus stop | **FIXED** | A 900,000-byte 'jobs.input' to a job that never reads stdin ran concurrently with delayed 'jobs.stop'. Stop fulfilled, input rejected after pipe teardown, job became 'killed', owned process died, and the inner race completed in about 103 ms. |
| Parallel shell dispatch | **FIXED** | Two one-second foreground shells in 'Promise.all' returned A and B; inner elapsed about 1.025 s, not serialized to about two seconds. |
| Parallel shell plus handoff | **FIXED** | A 30-second foreground wait and 100 ms delayed 'handoff("yield-now")' completed the CLI in about 0.64 s with 'handoff:true'; managed job was dead after normal CLI shutdown. |
| Execute clean-exit descendant, ignored stdio | **FIXED** | JS spawned an owned 30-second descendant, confirmed its pidfile, then explicitly exited normally. CLI completed in about 0.53 s and descendant was gone. |
| Execute clean-exit descendant, inherited stdio | **FIXED** | Same check with inherited stdout/stderr completed in about 0.53 s; no inherited-pipe hang and descendant was gone. |
| Managed-job timeout | **FIXED** | 30-second job with 'timeoutSeconds:0.3' returned after about 302 ms as 'killed', 'timedOut:true', termination cause 'timeout'; process died. |
| Execute cancellation | **FIXED** | Harness sent SIGTERM to its exact CLI after an execute descendant wrote its pidfile. CLI exited nonzero in about 0.53 s and execute descendant was gone. |
| Unicode bounded output and artifact | **FIXED** | 5,008 Unicode characters produced a 4,000-character tail plus explicit overflow notice; complete artifact contained BEGIN…END and had mode 0600. Formatted result is larger than 4,000 because notice is additional. |
| Artifact creation failure visible | **FIXED** | Making only isolated session directory unwritable produced 'full output could not be saved: ... permission denied' plus bounded tail ending in END; failure was not silent. Permissions were restored. |
| Completion after capture pumps | **FIXED** | Twelve concurrent foreground jobs each emitted final 131,072-byte burst. Every status was 'completed' and every 'outputEnd' exactly 131,072. |
| 50 tasks | **FIXED** | Fifty zero-wait shells launched via 'Promise.all'; list reported 'launched=50,total=50,done=50,completed=50'. |

Exact final values are in each 'manifest.json'; timings vary slightly.

## Original differential and remaining blocked checks

- **BLOCKED / untested executable differential:** 'bin/die-original' does not support direct '--execute', so snippets cannot run through the same isolated entry point. No claim of exact original/candidate output-format equality is made.
- **Source-contract comparison only:** original TypeScript runtime avoids holding shared state mutex over stdin backpressure, kills execute worker process group after leader completion, uses asynchronous/multiplexed bridge calls, aborts outstanding foreground waits on handoff, and bounds/spills execute output. Observed candidate behaviors now match those safety contracts.
- **BLOCKED as a pure no-provider CLI check:** app-level “foreground result must not also trigger a background model turn” ACK ownership cannot be observed end-to-end through '--execute' without allowing a subsequent model/provider turn. No credentials or provider calls were permitted. Source race coverage 'TestForegroundCompletionOwnershipAndCrashRestore' passed, and black-box handoff/concurrency checks exercise bridge, but this is not an end-to-end app/provider differential.
- Native/cache-affine compaction and cross-provider behavior from broader review are outside this runtime executable lane and were not tested.

## Action for the implementation orchestrator

No runtime fix is requested from final executable results. Preserve/re-run 'validation/runtime-recheck.py' after any further runtime/runner rebuild. Treat any distributed binary older than final SHA 'd99aaefa…' as unvalidated; active rebuilding occurred during this review.
