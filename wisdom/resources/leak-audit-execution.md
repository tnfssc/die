# Leak audit — execute sandbox and web launcher

Date: 2026-09-18.
Scope was independently limited to `src/typescript/*` execute runtime and `src/web/launcher.ts`.
No product code was changed.
Probes only killed PIDs they created explicitly.
No broad process signals were used.

## Runtime coverage

- Existing focused suite: `bun test tests/typescript-execution.test.ts tests/typescript-runner.test.ts tests/execute-output-capture.test.ts tests/job-bridge.test.ts tests/job-bridge-protocol.test.ts tests/web-launcher.test.ts`: **83 pass, 0 fail**, 17.47 s.
- Durable probes:
  - `bun scripts/leak-audit/execution-runtime.ts`
  - `bun scripts/leak-audit/web-launcher-runtime.ts`
- Probe temp roots use `mkdtemp` and are recursively removed.
  The execution probe explicitly tracked 10 spawned descendant PIDs and ended with `stillAlive: []`.
  The web probe tracked launcher/backend/grandchild PIDs and explicitly SIGKILLed only those still alive in `finally`.
  A subsequent `ps -p` showed none.

## Findings

### High: web launcher does not contain or reap backend descendants

`runExternal` starts a non-detached child (`src/web/launcher.ts:87-90`) and forwards SIGINT/SIGTERM only with `child.kill`.
There is no process-group ownership, descendant cleanup, or escalation.
Its promise resolves only on child error/exit (lines 98-102).

Two deterministic owned-process probes:

1. Backend and grandchild both ignore TERM.
  500 ms after SIGTERM to compiled `die web`: launcher, backend, and grandchild were all alive (PIDs 1966183/1966189/1966190).
  This can leave the CLI permanently hung after Ctrl-C/TERM.
2. Backend traps TERM and exits, but its `sleep 300` descendant does not.
  The launcher exited while owned grandchild PID 1966207 remained alive.
  The probe then explicitly killed it.
  This is a confirmed orphan path, not just static suspicion.

The launcher also reports the backend's graceful exit code rather than preserving that termination was user-requested (lines 89-102), so a TERM-triggered backend exit 0 can make the launcher return success.

### High: complete text spill is disk-unbounded, and timeout is optional

The in-memory preview is bounded to 4,000 decoded characters (`src/typescript/output-capture.ts:9, 166-175`), but after promotion all bytes are written to artifact files with no byte ceiling (lines 178-225).
The public tool passes `undefined` when no timeout is requested (`src/typescript/extension.ts:83-90`).
So execute code can continuously write until disk exhaustion.
Session-backed artifacts are intentionally durable.
No cleanup/retention limit was found in this path.

Runtime evidence: 24 executions emitted 1.25 MB each (30 MB total), all complete artifact files were produced while response previews remained bounded.
The probe cleaned its temp tree.
Capture works as the tests expect. But it has no disk cap.

### Medium: job bridge has bounded frames but unbounded in-flight cardinality

Each partial/request/response frame is capped at 1 MiB (`src/typescript/job-bridge.ts:50, 176-203, 314-315, 537-540, 629`), but child `pending` and parent `requests` are unconstrained Maps (lines 212-228 and 438-447/617-625).
Sandbox code can issue arbitrarily many concurrent helper calls, forcing allocations and handler dispatch in the long-lived parent.
This is pressure rather than retained leakage: teardown clears both Maps.

Runtime teardown evidence: six bridge requests deliberately remained pending through timeout.
All six handler AbortSignals fired (`bridgeAborts: 6`), FD count returned/stayed at 8. The process continued normally.

### Low/static: rare output-pump rejection can bypass capture handle close

`output.consume` can reject on a Readable error. `executeIsolated` awaits `outputPumps` at lines 146-165, then its `finally` destroys streams but does not call `output.result()`.
File handles opened by `ExecuteOutputCapture` are normally closed only in `result()` (`src/typescript/output-capture.ts:91-104`).
So an OS/stream read error after spill can leave artifact FileHandles open in the long-lived parent.
Normal child failure, timeout, abort, and write-error paths did not reproduce this.
This is a narrow static path.

### Low/static: settings temp can remain after rename failure

`seedWebSettings` writes a unique temp and directly renames it (`src/web/launcher.ts:57-59`) without a failure cleanup `finally`.
A rename failure/race can accumulate temp files.
Normal successful launches do not.

## Positive lifecycle/resource evidence

### Execute probe results

| phase | RSS KiB | heap bytes | FDs |
|---|---:|---:|---:|
| baseline | 28,388 | 1,190,668 | 8 |
| warm (5) | 40,148 | 2,819,047 | 8 |
| 80 short | 50,844 | 3,957,035 | 8 |
| 24 spill / 30 MB | 67,440 | 4,353,454 | 8 |
| 24 timeout | 60,428 | 6,223,168 | 8 |
| 24 abort | 59,608 | 7,223,416 | 8 |
| 50 bridge success | 59,196 | 4,996,788 | 8 |
| 6 bridge timeout | 60,184 | 4,037,102 | 8 |
| 10 descendant cleanup | 58,512 | 4,034,518 | 8 |
| 120 additional short | 58,560 | 4,899,113 | 8 |

RSS plateaued across the final 120 process lifecycles (+48 KiB), all snapshots had 8 FDs, bridge cancellation propagated 6/6, and descendants survived 0/10.
Heap/RSS peaks after spill/abort were reclaimed substantially.
Allocator high-water remains above cold startup but does not show monotonic retained growth.

The reason normal execute descendant cleanup is strong is visible at `src/typescript/execution.ts:81-86, 118-130`: POSIX workers are detached process-group leaders, TERM targets the group, KILL escalation is armed. The group is KILLed again when the leader exits.
Timers/listeners/streams/bridge are cleared/destroyed at lines 165-179.

Text memory is bounded: shared 4,000-character accounting (`output-capture.ts:156-175`), line tail max 900 per stream (lines 50-54), and prefix buffers are cleared on spill (lines 194-200).
Image channel retention is bounded by `MAX_IMAGE_CHANNEL_BYTES` and `BoundedOutputBuffer` (`execution.ts:89,134-145`. `images.ts:6-13`).

### Web repeated clean-exit results

Directly calling `runWeb` with an executable immediate-exit fixture 1,010 times:

| phase | RSS KiB | heap bytes | FDs | SIGINT/SIGTERM listeners |
|---|---:|---:|---:|---:|
| baseline | 22,952 | 639,442 | 8 | 0 / 0 |
| 10 warm | 31,416 | 879,045 | 8 | 0 / 0 |
| 1,010 total | 42,036 | 1,371,498 | 8 | 0 / 0 |

No FD or signal-listener leak was observed.
RSS rose 10.4 MiB after warm across 1,000 launches while forced-GC heap rose ~492 KiB.
This is consistent with runtime/allocator child-process high-water, not evidence of a per-launch live handle leak.
Signal listeners are correctly removed by `finish` on normal child error/exit (`launcher.ts:91-102`).

## Validation caveat

A repository-wide `bunx tsc --noEmit` was attempted.
It was blocked by errors in concurrently created `scripts/leak-audit/bridge-retention.ts`.
Filtering compiler output showed no errors for the two scripts from this audit.
The focused 83-test suite and both runtime probes passed.

## Recommended fixes (not implemented)

1. Give web backend a dedicated process group/session on POSIX. Forward to the group, add bounded TERM→KILL escalation, and perform a final owned-group reap on leader exit.
  Preserve signal-derived CLI status.
2. Add a maximum complete-output byte budget (or truncate artifact with explicit metadata), plus a safe default execution timeout and artifact retention policy.
3. Cap concurrent job-bridge requests and reject/backpressure above the cap.
4. Ensure capture handles close in the execute `finally` even if a stream pump rejects.
5. Unlink settings temp in a `finally` when rename does not commit.
