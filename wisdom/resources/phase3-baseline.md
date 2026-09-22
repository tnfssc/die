# Phase 3 baseline — 2026-09-05

## Decision

Phase 3 is complete for the current Linux/Bun baseline. This closes the implementation phase, not all future reliability work or cross-platform validation. Version `0.1.0` is the local baseline; no release upload or remote push is part of this validation.

Final checks on the source being committed:

| Check | Result |
| --- | --- |
| `bun run check` | Passed |
| `bun run test` | 65 passed, 6 opt-in LLM tests skipped |
| `bun run test:llm` | All 6 passed |
| `bun run smoke` | Passed |

The deterministic suite includes 50 concurrent tasks, bounded output, UTF-8 cursor handling, execution cancellation, process groups, and shutdown escalation. Authenticated tests use `openai-codex/gpt-5.6-luna`.

Earlier fixture validation and pending-task UX findings are recorded in [phase3-validation.md](./phase3-validation.md).

## Multi-file repository workflow

A fresh, isolated copy of this repository was used for an implementation exercise. Dependencies were shared read-only by convention through a `node_modules` symlink; the model was explicitly instructed not to install dependencies or change the original repository. This was a larger task than the cart fixture, but still a small repository, not an independent large-codebase benchmark.

The model was asked to add optional status/kind filters to task listing, apply filters before pagination, add regression tests, and document the feature. It delegated a read-only review while implementing, then ran typechecking and tests asynchronously.

Observed:

- Changes spanned implementation, tests, and README: 35 inserted lines and 2 removed lines across 3 files.
- Two calls attempted to import an unavailable `glob` package; the model recovered using filesystem APIs rather than installing a dependency.
- One large read was explicitly truncated by `execute`; the agent continued with focused reads.
- An initial timing-sensitive test failed. The agent increased its wait margin and reran the tests successfully. This is weaker than a readiness-based test and is not being adopted into the product.
- Review and command completions arrived automatically. The model did not poll or issue waiting-only tool calls.
- The model reported a passing typecheck and 22 selected deterministic tests after review completed.
- An independent build/typecheck and broader deterministic test selection confirmed **62 tests passed** in the exercise copy, excluding authenticated and tmux harness tests.

The exercise feature is **not merged** into the product. Its patch is retained only as validation evidence.

## Resource observations

A Python observer sampled Linux `/proc` data once per second, tracking the tmux launcher, agent, and observed descendants, along with transcript byte counts. CPU percentages use one logical CPU as 100%. RSS is not PSS and aggregate RSS double-counts shared pages; one-second sampling can miss short-lived peaks/processes. The following samples were collected during the first repository run, before the shutdown fix described below.

| Phase | Sample span | Main agent mean CPU | Main agent RSS | Transcript growth |
| --- | ---: | ---: | ---: | ---: |
| Initial idle | 14 s | 0.20% | 107.4 MiB | 0 bytes |
| Coding/review/checks | 136 s | 2.46% | 107.4–170.3 MiB | ~793 KB |
| Post-coding idle | 41 s | 0.33% | 115.9–126.9 MiB | 0 bytes |
| Idle with one pending task | 21 s | 0.23% | 123.3–123.7 MiB | 0 bytes |

The main agent's sampled coding CPU peak was 23%. Aggregate process-tree RSS peaked at **896.9 MiB** during typechecking; the compiler process alone accounted for approximately 604 MiB. No continuous idle terminal repaint was observed, including while the footer showed a pending task. RSS declined after the coding workload rather than remaining at its peak.

These are short-run observations, not a memory-leak proof, a long-session soak, or a global resource limit.

## Cancellation and the shutdown blocker

### Escape cancellation

The model started an `execute` process that ignored SIGTERM and remained alive on an interval. After its PID readiness marker appeared, Escape was sent through the real TUI. The tool reported `Execution cancelled (SIGKILL)`, the child was gone, and the same session accepted another prompt.

### Initial shutdown failure

A command task launched a parent and child that both ignored SIGTERM. Quitting the real TUI with Ctrl+D left both alive after seven seconds. They were explicitly cleaned up before continuing validation.

The task manager had scheduled an unreferenced escalation timer but its session shutdown handler returned immediately; the compiled CLI exited before escalation ran. A related case could clear the timer when the shell exited while descendants with closed output pipes remained alive.

### Fix and retests

- `TaskManager.shutdown()` now returns an idempotent promise that resolves after running tasks close.
- The extension awaits that promise before session disposal completes.
- If a task being terminated loses its group leader, remaining group members receive SIGKILL rather than losing escalation on stream closure.
- Repeated kill requests do not reset/create extra grace timers; completed timer references are released.
- New deterministic tests cover awaiting shutdown before a host explicitly exits, idempotency, and surviving descendants with closed output pipes.

Two fresh real-TUI shutdown retests passed:

1. A shell launched a stubborn parent and child.
2. `exec` replaced the shell with the stubborn process, so the task group leader itself ignored SIGTERM and required escalation.

After Ctrl+D and the grace period, both parent and child PIDs were gone in each retest. The test sessions exited naturally and temporary fixture processes were cleaned up.

## Evidence and remaining limits

Local, git-ignored artifacts:

- `artifacts/tui/repository-validation-2026-09-05T00-09-43.697Z/`: transcript, frames, history, exercise patch, raw resource samples, observer, and resource summary.
- `artifacts/tui/shutdown-validation-2026-09-05T00-18-26.780Z/`: first successful shutdown retest and process check.
- `artifacts/tui/shutdown-escalation-2026-09-05T00-19-27.063Z/`: successful stubborn-group-leader retest.

Still deferred or limited:

- Windows process-tree termination and cross-platform releases are not validated.
- Deliberately detached processes can escape process-group cleanup; this is not a security sandbox.
- Long-session memory behavior and aggregate budgets remain outside this baseline.
- Brief repeated acknowledgements remain a model UX imperfection.
- The exercise is a multi-file task in this small repository, not proof of performance on a much larger external project.
