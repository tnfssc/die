# Phase 3 validation — 2026-09-04 (UTC)

## Result

The hardened `execute` tool passed authenticated model tests and a real tmux TUI coding workflow. This validates the main integration path, not every module-resolution case or long-session/resource behavior. At this point Phase 3 remained in progress. The async UX follow-up below removed wasted waiting tool calls in a repeat run. Subsequent repository/resource validation and the baseline decision are recorded in [phase3-baseline.md](./phase3-baseline.md).

## Authenticated suite

Command: `bun run test:llm`

Model: `openai-codex/gpt-5.6-luna`, minimal thinking.

Five tests passed:

- Basic authenticated request.
- File creation and readback using `execute`.
- Recovery from an intentional `execute` error.
- Automatic command-task completion.
- Automatic sub-agent completion.

The new recovery regression inspects JSON tool events: the first execution reports `isError: true` with a sanitized `<execute-module>` stack, a subsequent execution succeeds, and the model produces the expected final response. It does not accept the final answer alone as proof that tools ran.

Typecheck and build also passed. The preceding deterministic reliability pass reported 58 tests passing plus the standalone smoke test.

## Real TUI coding workflow

Harness session: `phase3-validation`, Luna with low thinking, ephemeral session. The harness session was stopped after validation.

A temporary project contained:

- `totals.ts`: `totalCents(items)` incorrectly summed prices without multiplying quantities.
- A contract requiring nonnegative safe-integer prices, quantities, and result; empty carts total zero.
- Two existing tests for quantity multiplication, empty carts, and zero quantities.

The agent was asked to inspect with `execute`, delegate a read-only review using `subagent`, fix the implementation concurrently, add review-driven tests, and run `bun test` using `task` without polling. All fixture edits were restricted to the temporary project.

Observed:

- Reads and edits used `execute`.
- A review sub-agent ran while the parent fixed the implementation.
- The footer displayed `1 task running` while review work was pending and cleared after completion.
- Review completion arrived automatically with an output preview.
- The implementation multiplied quantities and rejected invalid inputs, unsafe products, and unsafe accumulated totals.
- The agent added tests for invalid values and overflow without removing the existing tests.
- The asynchronous test command completed automatically: **4 tests, 13 expectations, 0 failures**.
- An independent test run confirmed those results.
- A follow-up intentionally threw an error through `execute`; another execution then read the implementation successfully. No files were changed during that recovery probe.

Local artifacts (ignored by git):

`artifacts/tui/phase3-validation-2026-09-04T23-48-49.995Z/`

Includes the ANSI transcript, recorded frames, full history, final frame, resulting fixture files, and a separate JSON error-recovery trace. These are local evidence, not published artifacts.

## Rough edges and limits

1. While waiting for review, the parent made unnecessary `execute` calls that printed waiting acknowledgements. It did not poll `task`, but still spent tool calls/model turns without useful work.
2. One attempted task call omitted required `action`; schema validation rejected it, and the model corrected the call to spawn the test command.
3. The parent emitted implementation summaries before test completion, explicitly saying tests were still running. It did not fabricate a passing result, but the interaction was more repetitive than intended.
4. Review suggestions were not exhaustively implemented: successful exact safe-integer boundaries, fractional prices, and negative infinity were among the untested suggestions. The four passing fixture tests are not exhaustive contract coverage.
5. This was a small fixture on Linux, not a large repository study, cross-platform validation, or a resource benchmark.

## Pending-task guidance follow-up — 2026-09-05 (UTC)

Changes:

- Tool guidance now explicitly permits ending the turn when no independent work remains, prohibits no-op `execute` waiting calls, and requires a single pending-work acknowledgement.
- `task` descriptions and guidelines show the required `action` with single-command and batch spawn examples. The strict schema is unchanged.
- Spawn results remind the model that ending the turn does not cancel background work.
- A new authenticated JSON-event regression requires exactly one valid task spawn, no other tool calls, an automatic completion event, and the final answer after that event.

That regression initially failed: the model correctly yielded, but print/JSON mode disposed its session before a four-second task completed. Earlier half-second completion coverage had missed this race. An `agent_end` hook now holds the noninteractive idle boundary until a task completes (or the turn is aborted), flushes its notification, and lets Pi continue. Spawn still returns immediately; TUI/RPC interaction is not blocked. Error/aborted turns do not enter the wait.

Validation:

- **63 deterministic tests passed**, with 6 authenticated tests skipped in the ordinary suite.
- **All 6 authenticated Luna tests passed**, including the new one-call pending-task regression.
- Typecheck and build passed.
- Deterministic lifecycle coverage checks print/JSON waiting for one result rather than all tasks, notification flushing, cancellation, and the nonblocking TUI path.

The same cart-total prompt and original defective fixture were rerun in the real TUI with Luna/low. The root made six useful `execute` calls (inspection, implementation/test edits, and checking/correcting a test edit), one sub-agent call, and two valid task spawns. There were **no no-op waiting calls, task polls, or missing-action validation failures**. Review and initial test results arrived in a batch; the agent added review-driven boundary tests and ran a final asynchronous test command. An independent run confirmed **4 tests, 15 assertions, 0 failures**.

There were still two brief acknowledgements in each waiting phase (commentary plus final text), despite the single-acknowledgement guidance. No test success was claimed before completion. This is an improvement observed in one repeat run, not a guarantee of universal model compliance.

Local artifacts:

`artifacts/tui/pending-guidance-validation-2026-09-04T23-58-26.745Z/`

Includes recorded frames, transcript, full history, final frame, and resulting fixture files. The harness session was stopped and the temporary project removed after preserving evidence.
