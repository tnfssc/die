# Execute lifecycle/resource release fixes

2026-09-18. Scope: src/typescript/** and execute/bridge tests only. Read wisdom/resources/memory-resource-judgment.md and leak-audit-cli/execution notes. Two workers owned disjoint bridge versus capture/execution files; orchestrator reviewed integration and added budget edge/schema tests.

## Implemented

- Bridge request state now distinguishes result ownership by method and response: only foreground shell/subagent results need provisional delivery ownership (including mixed subagent batches).
- Observational/background successful replies release request state and cancellation-wrapper listeners on ACK. Handler-error/serialization/oversize fallbacks immediately abort and discard controllers; only a minimal protocol ACK token remains until acknowledgment.
- Foreground ACK remains provisional: only clean worker completion commits notification ownership. Crash, cancellation, disconnect-before-ACK, and failed delivery restore notification ownership. No task-manager changes.
- Automatic complete stdout/stderr capture now shares a **10 MiB per-execution default byte budget**, configurable via execute **outputByteLimit** (nonnegative safe integer). Zero disables complete-byte retention, not the separate bounded preview. The tool description and source document the policy; no default timeout added.
- Metadata: outputByteLimit, outputBytes, capturedOutputBytes, outputTruncated, stdoutBytes/stderrBytes, stdoutCapturedBytes/stderrCapturedBytes. Counters distinguish observed bytes from the retained budget prefix; filesystem/read errors remain separately explicit in outputArtifactErrors.
- Complete artifacts retain only the budgeted prefixes, draining/counting subsequent output without writing it. Inline tail contracts (4,000 combined characters and existing line limits) remain independent and unchanged. Formatting explicitly reports truncation and never calls a limited artifact complete.
- Both output pumps settle before finalization; capture result/handle closure runs in execution finally even after pump rejection. Read errors are exposed as artifact metadata.
- No generic concurrency cap, artifact expiry/deletion, arbitrary timeout, tasks/task-manager/web edit, installation, commit, or tag.

## Validation

- Final combined suite: **116 passed, 0 failed**, 900 assertions across 8 files (25.75 s): bun test tests/typescript-execution.test.ts tests/typescript-runner.test.ts tests/execute-output-capture.test.ts tests/job-bridge.test.ts tests/job-bridge-protocol.test.ts tests/typescript-images.test.ts tests/execution-previews.test.ts tests/execution-previews-tui.test.ts.
- Added tests cover immediate observational ACK cleanup, failed RPC cleanup before ACK, background-vs-foreground ownership, combined byte limit and metadata, default 10 MiB disk ceiling after draining 12 MiB, zero budget, UTF-8 byte accounting, configured execute and registered-tool propagation, and Linux artifact FD closure after stream rejection.
- Existing bridge delivery tests continue covering clean completion, crash after provisional ACK, disconnect before delivery, oversized fallback, batch subagents, and handoff.
- Before bridge fix: 10,000 sequential jobs.list calls retained 10,000 cancellation listeners and ~5.87 MiB heap until close. After fix: **zero listeners** at every 2,000-call checkpoint, heap plateau ~1.44 MiB. Command: bun scripts/leak-audit/bridge-retention.ts.
- Execution runtime probe: **8 FDs at every snapshot**, including short executions, 24 spill runs, timeout/abort, bridge calls, and 120 final short runs. Bridge cancellation 6/6; owned descendants surviving 0/10. Command: bun scripts/leak-audit/execution-runtime.ts.
- git diff --check passes. Local tsc --noEmit currently blocked only by shared-workspace unrelated src/cli.ts(131,58): missing ./history/session-manager. No owned-file type errors reported.

## Files

src/typescript/job-bridge.ts, output-capture.ts, execution.ts, extension.ts; tests/job-bridge-protocol.test.ts, execute-output-capture.test.ts, typescript-execution.test.ts.

Budget scope is per execution, not cumulative session storage. Existing artifacts remain evidence; truncation is explicit rather than pretending unlimited capture. This is resource safety, not a sandbox boundary.
