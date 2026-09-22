# Core resource fixes pre-release review

Scope: `src/tasks/task-manager.ts`, `src/tasks/output-buffer.ts`, `src/typescript/**`, `src/web/launcher.ts`, related new tests, and `wisdom/resources/resource-limits.md`. History/webcache work was ignored as requested.

## Findings

### Medium — completed-output budget is applied after synchronous completion observers

**Evidence:** In `src/tasks/task-manager.ts:258-272`, the manager resolves the completion snapshot, emits `completed`, records diagnostics, and invokes `onComplete` before calling `#retainCompletedOutput(task)`. The latter is the operation that adds both `task.output.retainedBytes` and `Buffer.byteLength(task.completionOutput)` to the aggregate and evicts old bytes (lines 492-516).

A synchronous `completed` subscriber or completion callback can therefore call `inspect()`/`wait()` and observe output (including a subagent final string) which a zero/small completed budget should already have evicted. This contradicts the documented completed-state invariant and makes observer-visible state depend on callback timing. The completion/notification snapshot can remain an intentionally separate delivery object, but manager retention should be accounted/evicted before exposing the completed state to callbacks/events. Add a regression with budget 0 and an `onComplete` or `completed` listener that inspects the task synchronously; include an agent final-answer case.

### Low — zero/exhausted capture budget creates empty spill artifacts and advertises their paths

**Evidence:** `ExecuteOutputCapture.#startSpill()` opens a file for every stream with `hadBytes` (`src/typescript/output-capture.ts:252-273`), even when that stream's `capturedBytes` is zero. A 5,000-character stream with `outputByteLimit: 0` crosses the preview threshold and returns a `stdoutPath` to a zero-byte file. Reproduction:

`new ExecuteOutputCapture({outputByteLimit: 0}).consume("stdout", Readable.from(["x".repeat(5000)]))`

returns `capturedOutputBytes: 0`, `outputTruncated: true`, and a defined empty `stdoutPath`. This is inconsistent with “zero disables complete-byte retention,” creates needless artifact directories/files, and differs from the existing short zero-budget test. Open/advertise an artifact only when the stream has retained bytes (for example, `capturedBytes > 0`), and add a zero-budget-above-spill-threshold test. The same issue occurs for a stream that emits only after the shared budget was exhausted.

### Low — “captured/retained bytes” counters remain positive after artifact creation/write failure discards those bytes

**Evidence:** `#append()` increments per-stream and aggregate captured counters before persistence (lines 220-225). If `#startSpill()` cannot create the directory, it clears every retained prefix (lines 263-266) without correcting those counters; write failures likewise leave counters at the selected-byte count. Consequently `capturedOutputBytes` can claim bytes are retained when no inline complete prefix or artifact contains them, contrary to the interface/doc wording (“bytes retained”). Artifact errors make the failure visible, but the new accounting fields are still false. Either account successfully retained/persisted bytes (including partial writes) or rename/document these as attempted/allowed bytes and expose actual retained bytes separately. Add assertions to the existing unwritable-artifact test.

## Validation

- Targeted suite: 72 passed across task buffer/manager, TypeScript capture/execution/bridge, plus the web tests when run against source.
- Initial combined run had 2 web failures because `tests/web-launcher-process.test.ts` defaulted to the stale checked-in `dist/die` binary. Re-running that test with a temporary executable importing current `src/web/launcher.ts` passed all 3 tests, including stubborn-group escalation, early leader exit, and repeated listener/FD cleanup. This is not a source regression, but release validation must rebuild `dist/die` before running the binary-level test.
- ACK/crash ownership tests passed; code inspection found provisional ACKs are committed only after clean worker exit and aborted on disconnect/failure.
- No unsafe signaling of the launcher's own group was found in the reviewed source; the POSIX launcher signals only the detached child-owned PGID, and source-level process-group tests passed.

## Release assessment

No high-severity process-ownership or ACK/crash blocker found. The completed-budget callback-order issue should be fixed before release because it violates the new observable budget semantics. The two capture findings are lower severity but actionable correctness/documentation gaps.
