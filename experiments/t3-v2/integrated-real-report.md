# Real-engine followthrough

## Status

**The deterministic real-engine path passes. Full acceptance is still incomplete.**

Run:

- experiments/t3-v2/integrated-real-probe.sh
- experiments/t3-v2/integrated-process-proof.sh (also needs strace)

No paid model, mock MCP, or fake provider is used in this path. The HTTP model peer is deterministic. Real upstream orchestrator/event stores/projections/effect worker, real Effect MCP transport + orchestrator toolkit, production ProviderSessionManager MCP credential lifecycle, real PiAdapterV2, Node ChildProcessSpawner and unchanged dist/die execute every parent/child turn.

## Harness and lifecycle fixes

The replay helper normally disables MCP configuration and injects a test registry. The runner derives a uniquely staged helper from the pinned upstream source with only two substitutions: configureMcp=true and the production registry layer instead of its testkit. No production adapter wrapper remains. The run removes the derived helper and integration test on exit. It needs no upstream source changes or extra upstream.patch edits. The HTTP authorization middleware is a small test-local copy of production bearer resolution. The registry, protocol transport, toolkit, and thread capability scope are real. This is not the full application server boot stack.

it.live fixes the old Effect finalizer hang. A longer timeout does not. A second harness bug came from the model peer classifying the whole conversation by child task literals. The parent's execute output quoted the cancellation task. The peer then wrongly withheld the parent's final response. Routing by user-role parent/child identity fixes the cause. **Parent now reaches completed naturally. No cleanup interrupt is used.**

## Assertions and captured observables

- Parent runs delegate_task(wait), a same-clientRequestId replay, task_status, async cancellation child creation, task_cancel, and a second cancel through the real execute bridge. Cancellation waits on a deterministic model-peer readiness barrier. the cancellation child must actually reach its held HTTP model request before Stop, instead of relying on a guessed sleep.
- Two intentional app-owned children exist: one successful child and one interrupted child. Stable replay does not create a replacement success child/run.
- Success child executes a real execute tool (INTEGRATED_CHILD_TOOL_EVENT), then emits INTEGRATED_REAL_RESULT_7bde9d. Two success-child model HTTP requests belong to one child run, not two spawns. Exactly one cancellation-child model request is observed.
- Successful delivery reaches acknowledged. Cancellation delivery reaches disposed. Exactly one successful subagent_result transfer and one parent final assistant message exist.
- Compact execute output returns the success marker once to the parent model continuation. Repeated result reads are compared, not redundantly printed.
- Only execute is model-visible on every parent/child model request.
- Parent/child tokens differ and the real registry resolves the child token to its child thread. Anonymous access gets 401. A sibling's task_status/task_cancel calls are rejected as task_not_found. A revoked initialized transport gets 401.
- Upstream typed orchestration failures can have isError=false with structuredContent._tag=OrchestratorMcpFailure. Negative tests assert the typed failure code, not the misleading boolean alone.
- OS execve tracing observes exactly three provider RPC Die launches (parent + two intentional children), two execute workers, and **zero local --mode json subagent launches** for this scripted success/retry/cancel scenario. This is not a universal runtime policy: local subagent() remains callable.
- Scope finalization verifies all three provider PIDs reaped. The script separately cleans identity-pinned detached groups on watchdog failure.

Sanitized IDs/counts/auth outcomes and process categories are in integrated-process-proof.json. Detailed runner output is in .runtime/integrated-real.log. Actual events/projections are exported to .runtime/integrated-real-result.json for the same-child browser proof. No bearer contents enter captured evidence.

## Not claimed

No production adoption, paid-model smoke, full server restart, network/worker-ACK fault-window recovery, nested child closure, or arbitrary-model duplicate-spawn prevention. The SQLite engine store is real and file-backed. A closed, durable snapshot remains at .runtime/integrated-real-state.sqlite after provider/scope teardown. Copying its closed database into the isolated browser namespace proves UI projection/navigation, not reconnect to the same running engine process. Browser evidence must name its exact imported child IDs and remain distinct from the earlier mock-provider replay fixture.
