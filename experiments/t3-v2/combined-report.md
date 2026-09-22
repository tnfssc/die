# Combined PiAdapterV2 / Die followthrough

## Fixed boundary

The original reduced scope hang was a **test-clock error**, not evidence of a real stdin/process deadlock. it.effect supplies TestClock. PiRpc.terminatePiProcess sends SIGTERM and then sleeps for its one-second grace period in an uninterruptible scope finalizer. A test that never advances that clock cannot complete teardown; an external timeout cannot cancel through that finalizer. The minimal harness change is **it.live** for real OS processes. No upstream adapter change or increased timeout was needed.

The original assertion that open/ensure performs no MCP discovery was also false under live scheduling: initialize/initialized/tools-list can already occur during ensure. Those calls are not tool execution.

## Passing regression

**experiments/t3-v2/combined-probe.sh** now passes **2 real adapter/Die prompt tests**, direct dist/die and bridge-launcher (launcher + Die grandchild), in 5.07s total (3.78s tests). Each runs:

1. Actual upstream PiAdapterV2 + Node ChildProcessSpawner + isolated real Die RPC.
2. Session-scoped injected upstream MCP extension, with bridge activation retained.
3. Deterministic loopback OpenAI HTTP stream requesting actual execute.
4. Execute imports bridge-client and calls the explicitly **mock MCP echo** endpoint exactly once.
5. The echo marker appears in the second model request; model-visible tools are exactly execute.
6. Adapter emits provider_turn.updated/completed; scope finalizer enters and exits; launched PID is reaped.

**combined-proof.jsonl** records lifecycle event types, spawn PIDs, scope boundaries, authorized booleans, tool names and counts, without bearer contents. The runnable script stages/removes the upstream test and bounds the same 20s watchdog. Detached PiRpc groups get an identity-checked emergency cleanup instead of assuming timeout owns them.

## What this does NOT prove

The echo server is a mock transport. This test does not prove actual T3 delegation, durable child execution/result delivery, real MCP auth scoping, duplicate-spawn prevention, cancellation or browser navigation. The separate real-engine and actual durable browser proofs now pass; see integrated-real-report.md and browser-live-followthrough.md. General execute subagent remains callable; no runtime policy enforcement is claimed.

The causal frozen-clock/advance, cancellation and process-lifetime matrix is separately owned by clock-probe.sh/clock-report.md. Production pin, patch and executable remain untouched.
