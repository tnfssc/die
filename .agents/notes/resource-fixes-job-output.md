# Completed job output RAM budget

## Behavior

- `TaskManager` now applies an **8,000,000-byte aggregate in-memory budget** to output retained by completed jobs. The default is exported as `DEFAULT_COMPLETED_OUTPUT_BUDGET_BYTES` and can be overridden through `TaskManagerHooks.completedOutputBudgetBytes` (including zero for callers/tests that want no completed output retention).
- 8 MB is a deliberately simple, modest default: it preserves several maximally noisy recent jobs (the existing active cap is 1,000,000 bytes per task) while making sequential completed-job output residency finite. This is RAM retention only; job IDs, status, timestamps, exit/termination data, and other metadata remain available.
- Running jobs remain independent: every active task keeps its existing 1,000,000-byte tail. Active output does not consume or get evicted by the completed-output aggregate budget.
- On completion, output joins a FIFO retention order. If the aggregate is over budget, the oldest retained prefixes are released first. Logical `baseOffset` advances while `outputEnd` remains stable. A caller inspecting an evicted offset receives `outputLost: true` and a truthful advanced `nextOffset`; no discarded bytes are represented as if they still existed.
- UTF-8 inspection remains character-safe if aggregate eviction lands inside a multibyte character: continuation bytes are not emitted as replacement text, `outputLost` is set, and cursors still advance to the real logical byte offsets.
- The special completed-agent final-answer string is included in the aggregate accounting and is dropped when its old job is evicted. Completion snapshots already handed to a foreground waiter or notification callback remain intact. This preserves completion/foreground race ownership while bounding manager-owned historical output.
- No disk backing was added. Old output loss is explicit through the existing API contract.
- Shutdown behavior is unchanged: close processing still resolves waiters, emits lifecycle/diagnostic events, suppresses shutdown notifications as before, then accounts/evicts completed output.

## Implementation

- `BoundedOutputBuffer.discardPrefix(bytes)` releases retained chunks without changing `endOffset` and returns the actual byte count released.
- `TaskManager.#retainCompletedOutput` runs once from the child close transition, after completion delivery/event handling, and updates each evicted task's public `baseOffset`.

## Regression coverage

- `tests/output-buffer.test.ts`: explicit prefix release preserves logical offsets and reports loss.
- `tests/task-manager.test.ts`:
  - many sequential completed jobs remain listed with completed metadata while total retained buffer bytes stay within a tiny injected aggregate budget;
  - old offset inspection reports loss and correct end cursor, while newest output remains readable;
  - active Unicode output remains available before close, then a budget cut through a multibyte character yields safe text and honest offsets after transition.
- Existing task-manager tests continue covering concurrent completion/foreground notification ownership, 50 concurrent jobs, per-task noisy output, agent final-answer behavior, and shutdown/process-group semantics.

## Validation

- `bun test tests/output-buffer.test.ts tests/task-manager.test.ts`: 29 passed, 0 failed.
- Focused completed-output budget probe repeated 5 times: 5/5 runs passed (2 tests per run).
- `bun run check`: passed immediately after the owned changes. A later rerun was blocked by concurrent out-of-scope history work (`src/cli.ts` imports missing `./history/session-manager`).
- Related integration selection (`output-buffer`, `task-manager`, `job-service`, `job-attention`, `task-monitor`, `web-task-events`): 57 passed, 0 failed.
- A full-suite attempt reached 640 passed / 10 failed; failures were in concurrent/out-of-scope CLI build/version, RPC cancellation, preview, and web-launcher work. `bun run build` was likewise blocked by the concurrent `web/t3-source.json` checkout mismatch.
