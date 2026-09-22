# Isolated T3 orchestration-v2 prototype

**Real deterministic delegation, teardown and rendered child navigation now pass. Full acceptance is not complete; not adopted.**

Pinned experiment upstream: a9b49a7df0a4261dcc438d4493cc3154a1d9819e (PR #2829). Production backend, web/t3-source.json, web/t3.patch, dist/die, installed binary and existing production state are unchanged.

See [RESULTS.md](RESULTS.md), [integrated-real-report.md](integrated-real-report.md), [clock-report.md](clock-report.md), [combined-report.md](combined-report.md), [browser-live-followthrough.md](browser-live-followthrough.md) and [bridge-followthrough.md](bridge-followthrough.md).

## Reproduce without a paid model

Prerequisites: Git, supported Node (tested 24.15.0), Corepack, Bun, Python 3, GNU timeout, existing root dependencies and already-built dist/die. OS spawn proof additionally uses strace. These scripts do not rebuild or replace production binaries.

From repository root:

~~~sh
experiments/t3-v2/setup.sh
experiments/t3-v2/clock-probe.sh
experiments/t3-v2/combined-probe.sh
experiments/t3-v2/integrated-process-proof.sh
bun test experiments/t3-v2/bridge.test.ts experiments/t3-v2/bridge-client.test.ts experiments/t3-v2/bridge-launch-args.test.ts experiments/t3-v2/isolation.test.ts
bun experiments/t3-v2/audit-isolation.ts
~~~

The real-engine runner alone is integrated-real-probe.sh. It uses real upstream orchestration, file-backed SQLite, production MCP credential lifecycle, real HTTP MCP and PiAdapterV2 → Die. Only the OpenAI-compatible model peer is deterministic; MCP/providers are not mocked. The parent completes naturally after successful delegation, stable-ID replay, status and repeated cancellation. Scope logs verify reaped processes. integrated-process-proof.json adds OS-level spawn counts and sanitized IDs/auth outcomes.

Setup prefers the existing research mirror, otherwise fetches the exact commit from https://github.com/pingdotgg/t3code.git. T3_V2_UPSTREAM_REPO may select another source. New clones have no shared alternates; frozen dependencies/state/cache remain in .runtime. Setup refuses a mismatched runtime rather than deleting active state. Pin/state paths remain fixed; only named staged diagnostics are allowed. Existing executable hash and checkout revision/dirty status are recorded without claiming build provenance. Current real-engine regressions deliberately require the preserved root dist/die. Alternate launcher binaries and a clean no-binary bootstrap are not validated by this evidence; see setup-report.md.

## The timeout fix

Use **it.live**, not it.effect, for real processes. PiRpc's uninterruptible termination finalizer waits one second after SIGTERM. TestClock never advances unless told to: the child and grandchild can already be gone while scope close remains pending. clock-probe.sh proves 999ms remains pending and the final 1ms releases it. No production adapter change or increased watchdog was needed.

The integrated model peer also now routes by user-role thread identity, not child-task literals quoted inside a parent tool result. The latter incorrectly held the parent's final HTTP response open.

## Render the actual child

The latest proof serves a **copy of the closed real-engine SQLite database**, not the earlier mock-provider replay fixture. Only project-list metadata is added; real parent/child events are untouched. Chromium renders the parent relationship entry, clicks the exact child, refreshes, expands its real execute event and captures both tool/result markers. Source database/result hashes and matching engine IDs are in browser-live-proof.json.

After integrated-process-proof.sh:

~~~sh
experiments/t3-v2/browser-live-prepare.sh
experiments/t3-v2/browser-live-run.sh > experiments/t3-v2/.runtime/browser-live-dev.log 2>&1
# In another shell; stop the owned server after capture:
cd experiments/t3-v2
mkdir -p .runtime/browser-live-tmp
TMPDIR="$PWD/.runtime/browser-live-tmp" PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browser-cache" node browser-live-followthrough.mjs
~~~

Prepare refuses to overwrite existing proof state. Preserve/move aside only browser-live-final-state and browser-live-profile-final before preparing a different engine run. Chromium availability/software-rendering details are in browser-followthrough.md; the browser cache/profile are experiment-local. Normal one-time pairing is required; never copy pairing values into reports. This is persisted-state UI proof, **not a browser attached to the same live provider process**.

Ordinary isolated dev UI: run.sh dev (UI localhost:24733; backend127.0.0.1:32773). T3_V2_PORT_OFFSET selects bounded alternate ports. The browser proof uses30733/38773 and its own state namespace. No arbitrary dev host/state flags are accepted. Stop owned servers with Ctrl-C.

## Execute bridge and truthful ownership boundary

Configure the experimental Pi provider binary as the absolute bridge-launcher.ts path. It retains upstream's generated MCP/approval extension and adds bridge guidance once. Only execute is model-visible. From execute, import delegateTask, taskStatus and taskCancel from the absolute bridge-client.ts path. Always reuse clientRequestId for retried delegation. One-shot helpers close their HTTP MCP transport session without deleting the durable task.

The active client sends the required protocol header, matches response IDs, rejects redirects and supports DELETE. Upstream orchestration failures may be typed structuredContent with _tag=OrchestratorMcpFailure even when isError=false; callers must inspect the typed result.

**Local subagent() remains callable.** Runtime tests prove this. Scripted real delegation/retry/cancellation has zero local subagent launches in strace, but guidance is not an enforcement policy against a deliberately duplicated local launch.

## Remaining acceptance gaps

No worker-ACK/network disconnect fault matrix, live provider/server restart reconnect, real-adapter nested closure, or arbitrary-model exclusivity guarantee is claimed. No paid-model smoke is needed for these deterministic proofs. Coordinator review is required before any production pin/patch migration or root changes.

Optional regressions: run.sh test-ui, run.sh test-harness, and run.sh test-ui apps/server/src/orchestration-v2/Adapters/PiAdapterV2.test.ts apps/server/src/orchestration-v2/Adapters/piT3McpInjection.test.ts. Historical component reports remain explicitly labeled and are not substitutes for the real-engine proof.
