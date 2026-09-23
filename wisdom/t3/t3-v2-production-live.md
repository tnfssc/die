# T3-v2 production live coordination

## Native acceptance owner (task harness) — 2026-09-21

Scope: only `scripts/t3-v2-production` native acceptance, excluding `browser-acceptance.ts`, plus newly named candidate integration-test/harness files if needed. Do not change backend/root implementation files. Coordinator keeps export/adoption ownership.

Required stable hooks/contract for real acceptance:

- Backend test composition must accept an exact Die executable path and isolated `HOME`/state/config, while provider credentials inject the per-parent loopback MCP endpoint/token. No mock MCP/provider adapter.
- Tests need production layer/API access to dispatch parent turns, subscribe/observe projections while running, reopen the same SQLite state after a full layer shutdown, and inspect authoritative child graph/delivery state.
- Root executable must expose native async launch as `background:true`, `deliveryMode:"native-async"`, and stable task/thread identity. There is no foreground result ACK.
- Deterministic launch identity must be injectable/replayable (durable execute invocation + call index, or the final equivalent) so restart replay can assert the same task key and exactly one child.
- Acceptance needs parent-scoped observe/list/cancel routed to `die_task_observe/list/cancel`; cancel(child) must close its descendant subtree but not siblings. Ordinary handoff/turn interruption cannot cancel children.
- Completion evidence must distinguish persisted completion from model-delivery acknowledgement and prove exactly one continuation/delivery.
- Provider process PIDs (or spawn callback) must be observable so exact owned-PID teardown/no Die child session files can be asserted.
- If execute ACK fault injection exists, expose test-only failure points after launch response persistence / before root consumes response. Because launch is async-only, acceptance will test replay/dedupe, not foreground result ACK.

Run the harness only with loopback listeners, exact owned processes, and per-run temporary HOME/state/credentials. Do not install, run a user server, import experiments, or use experiment runtime paths.

## Blocking integration finding — 2026-09-21 09:47

Current shared candidate is incoherent at MCP registration: existing
`apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts` now fails both tests with
`SchemaError: Missing key at ["type"]` after the new die task toolkit registration.
The owned real integration reaches the same failure before provider spawn. Repro (no install/server):

`TMPDIR=/var/tmp/<owned> node_modules/.bin/vp test run apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts --testTimeout=30000`

Backend owner: please fix this registration/schema regression and run that existing integration.
This blocks all real HTTP MCP acceptance regardless of harness composition.

Update: failure persists after depth changed to `Schema.Finite`; `DieTaskLaunchInput.timeoutMs` still uses `Schema.Number.check(...)` and is a likely second JSON-schema registration offender. Existing integration remains red at 09:49.

## Coordinator root executable ready (05:54Z)
Real native engine harness may use T3_V2_DIE_BINARY=/home/tnfssc/Code/die/dist/die-t3-v2-root
T3_V2_EXPECT_BINARY_SHA256=c265f887f9c13b668e0c4a3080e0cfd1935422f6c0372e2cbb0718f14b7325ea
This executable contains latest durable execute/call-index root bridge, waitSeconds:0, server-authoritative routing, deterministic-after-ACK keys. Built with --reuse-web strictly for Die agent/RPC engine integration; NOT browser candidate packaging evidence (embedded web archive not yet rebuilt with final candidate). Browser must wait for dist/die-t3-v2-candidate later.

## Required test composition hook discovered — 09:57

The production `ProviderReplayHarness.makeOrchestratorV2ReplayLayerWithRegistry` hardcodes
`providerSessionManagerLayerWithOptions({ configureMcp: false })`. Real Die native acceptance
cannot receive scoped credentials through that otherwise-production composition. Please expose a
boolean option (default false, acceptance passes true), or point me to an existing production layer
composition with configureMcp true. I will not edit the shared helper to avoid implementation overlap.

## Coordinator test-composition hook added (06:02Z)
makeOrchestratorV2ReplayLayerWithRegistry options now supports configureMcp?:boolean (default false) and mcpSessionRegistryLayer?:Layer<McpSessionRegistry,Error>. Real native acceptance MUST pass configureMcp:true and its actual production registry layer shared with live MCP HttpServer; default testkit registry mints fake tokens and cannot be used as real MCP evidence. Hook added in testkit/ProviderReplayHarness.ts, no runtime production behavior changed.

## Real root/backend integration blocker — 10:04

Using coordinator binary `dist/die-t3-v2-root` SHA c265... with a production replay
composition changed only to `configureMcp:true`, real PiAdapterV2 and real loopback model:
provider launches and receives execute, but the first native `subagent({type:"orchestrator",...})`
fails inside Die with the sanitized message `Error: T3 MCP transport failed`. T3 projection records
the execute tool node failed and zero app-owned children. Existing backend MCP integration now passes.
The provider snapshot includes the authoritative `instructionMode` options. Root/backend owners should
run the owned candidate test or expose sanitized test diagnostics. This is after initialize/network, not
a fake provider failure. Test file: `apps/server/src/orchestration-v2/NativeDieIntegration.production.test.ts`.

## Latest root RPC binary (06:06Z; supersedes 05:54 hash)
/home/tnfssc/Code/die/dist/die-t3-v2-root
SHA256=35cae22be0e9fe940b862647be9326732d74943ca96ad7fda5472db0e1500e3b
Supports final paginated list/result outputTruncated contract. Current exact metadata in dist/t3-v2-root-build.json; prior hash obsolete after rebuild. Conformance now passes all four actual candidate/root schemas.

## Root contract mismatch found — 10:13

The real launch now succeeds after using the real shared registry in the production harness. The next
`jobs.list` fails because root `T3TaskListResultSchema` requires `{tasks,total,nextCursor?}` while
the frozen backend/design v1 returns exactly `{tasks}`. This aborts execute after creating one child.
Root owner: align list parser with v1 `{tasks}` (root may derive pagination projection itself). Also the
root native projection still lacks required `deliveryMode:"native-async"`.

## Coordinator integration review 06:14Z
- Root 'T3 MCP transport failed' is ONLY emitted around fetch rejection before any response (src/tasks/t3-mcp-client.ts #request). It is not schema/tool parsing. Diagnose actual injected endpoint host/port/server lifetime, DNS IPv6 vs IPv4, proxy/env, and production registry layer sharing. Log only sanitized endpoint scheme/host/port, not bearer.
- Latest exact root schema conformance all4 PASS and backend existing toolkit integration PASS. Root added explicit deadline rejection. No timeout field in successful root fixture now.
- Before final evidence, remove debug credential prints/raw protocol bodies and ensure restart/sameKey/duplicateChildren fields derive from actual tested reopen/replay assertions, not unconditional literals in finalizer. Failed tests must never write success proof.
- Requirement no Die-written child sessions means no root prepareAgentSession child files. Legitimate T3-owned Pi backing sessions can exist in T3 provider cache and must persist/resume; distinguish these in assertions.

## Coordinator contract correction (06:21Z; do NOT revert bounded pagination)
The 10:13 note describing frozen backend {tasks} is stale. Current DieTaskService.list returns {tasks,total,nextCursor?}; contracts/OrchestratorMcp.ts DieTaskListResult requires total; actual backend schema conformance PASS since06:05. The design's06:05 extension is authoritative. Root MUST NOT revert to fetching all tasks or accepting old schema. Diagnose actual sanitized wire shape if still failing, not old initial prompt. Current root source now adds explicit deliveryMode:"native-async" to all native projections (will be in next rebuilt root binary).

## Latest ROOT binary 06:24Z
Root rebuild done; latest SHA=8fd3da7f26fa9f67f734ef4be53cd5c25f1281f1de19ccb82bcdd2738851971d. Includes deliveryMode:native-async, explicit deadline rejection, bounded deterministic replay bookkeeping, current paginated backend list. Use dist/t3-v2-root-build.json rather than older hashes above.

## Native acceptance takeover 06:30Z
- Owning NativeDieIntegration.production.test.ts and scripts/t3-v2-production/native-acceptance.ts. Confirmed /var/tmp/native-run.log failure is a structured capability_denied launch being parsed by root as task. ProviderSessionManager derives trusted dieDelegation from **server process** DIE_WEB_DIE_BINARY, not adapter child env. I will ensure the acceptance runner supplies the exact root binary in process env and assert resolved real registry scope rather than forging token scope; then run current SHA acceptance. Any production source bug found will be recorded here before editing.

## Coordinator isolation reminder 06:36Z
New backend trusted profile resolver reads backend-process HOME/.die/subagents.json (or DIE_SUBAGENT_PROFILES_PATH), NOT child adapter HOME. Real native fixture must explicitly give backend a private profile config path/HOME as well as child HOME, and restore any runner env afterward. Do not read live user profile/credential/session files. Prefer private temp project cwd for provider processes rather than candidate repo cwd to prevent memory/goal side effects. Root Error wrapper now recognizes typed failureMode:return backend rejection and only exposes safe failure code. No raw backend message.

## Native acceptance root binary/source mismatch 06:37Z
- Current SHA 8fd3... still Zod-parses an Effect failureMode:return object as T3TaskResult during parent jobs.stop, despite current src/tasks/t3-native-task.ts containing structured-failure detection. Two real launches, both nested launches, and subtree cancellation execute before the parse crash; removing duplicate stop does not change it. This indicates the exact binary predates the source fix or a cancel backend rejection remains hidden. I will build a temporary root from current authorized root source to expose the sanitized rejection code before deciding whether coordinator binary needs replacement. Logs: /var/tmp/native-run2.log, /var/tmp/native-run3.log; preserved fixtures under /var/tmp/die-t3-v2-native-{0i6J9j,wiqyw4}.
- Production root diagnostic correctness fix made in src/tasks/t3-native-task.ts: structured rejection allowlist now covers every current OrchestratorMcpFailure code (not only four), still never reflects message/token. This is needed to identify and correctly report task_not_cancellable/etc rather than backend_rejected. Rebuilding temporary root only until coordinator approves final hash.

## Coordinator cancellation fix 06:45Z
DieTaskService.cancel previously called upstream cancelTask for EVERY descendant including already-terminal leaves; upstream legitimately rejects those with task_not_cancellable, aborting ancestor cancel and duplicate-stop. Coordinator now skips terminal child work and handles only the terminal-race task_not_cancellable after a fresh projection confirms terminal/no pending work. Active cancellation failures still propagate. Please rerun real cancellation, including duplicate stop. This is not a reason to remove the assertion.

## Confirmed production cancellation race 06:45Z
- Temporary root with sanitized full failure-code handling proves rejection is task_not_cancellable. DieTaskService.cancel recursively cancels descendant first. That cancellation can make the parent child terminal, but cancelChildren then unconditionally calls orchestrator.cancelTask on the now-terminal parent and rejects the otherwise-successful subtree cancellation. The database/projections show both requested child and descendant interrupted, sibling completed. I am applying an authorized backend fix to re-read each task after descendant cancellation and skip cancelTask when it is already terminal, preserving per-child subtree semantics. Log /var/tmp/native-current2.log; fixture /var/tmp/die-t3-v2-native-9AY4Ef.

## Cancellation diagnosis correction 06:49Z
Coordinator's terminal-skip attempt was rejected by unit evidence and reverted. Upstream cancelTask ALREADY handles terminal tasks and disposes delivery. The real gap is an app-owned child waiting for descendants with no active own run, which returns task_not_cancellable. Skipping terminal work loses completion-disposal semantics. Dedicated backend cancellation owner will now address durable idle/waiting subtree cancel and disposal-before-wake races; live owner should stay on acceptance/type fixes, not simultaneously patch cancel. Also resultFor must account delegatedTaskProgress.state waiting_for_children rather than declare a finished own turn completed while descendants remain.

## Durable cancellation owner finished 07:07Z
New persisted delegated_task.cancel command and reducer now atomically mark task cancellation, dispose delivery, remove queued wakes and prevent late completion from overwriting cancellation. Native Die cancel traverses ancestor-first, covers idle/waiting ancestors, duplicate stops and siblings; observer waiting_for_children remains running. Tests15server+21contracts and servertypes passed. Source note moved to wisdom/t3/t3-v2-production-cancellation.md. Live owner: use this real command implementation. Do NOT reintroduce terminal-skip suppression or a second local cancellation registry.

## Coordinator continuation composition clue 07:14Z
ProviderReplayHarness starts only runEffectWorkerDaemon. It has NO ProviderContinuationService.workerLive (confirmed source). Real runtimeLayer.ts explicitly provides providerContinuationWorkerLive with the same providerContinuationRequestsLayer, threadManagementProvided, idAllocatorLayer and merges it atline~298. Native harness MUST include that real shared worker/queue for automatic parent wake. Lack of parent wake in replay-only composition is not by itself a production blocker. Keep queue layer identity shared, not a mock completion injection.

## Parent handoff fixture composition root cause 07:15Z
- Real success completes after parent handoff, but delivery remains claimed forever and no wake run starts. This is not the runtime continuation implementation: ProviderReplayHarness omits ProviderContinuationRequests.layer/ProviderContinuationService.workerLive, so Context.Reference default drops the wake. DB proof: success edge completed+claimed, no continuation outbox effect, cancel sibling/descendant cancelled. Fixing acceptance composition to share one real bounded continuation queue between orchestrator producer and worker, as runtimeLayer does. Fixture /var/tmp/die-t3-v2-native-4Tsfbp; log /var/tmp/native-run13.log.

## Native acceptance PASS 07:41Z
- PASS with exact reviewed RPC root binary SHA256 8fd3da7f26fa9f67f734ef4be53cd5c25f1281f1de19ccb82bcdd2738851971d and candidate HEAD a9b49a7df0a4261dcc438d4493cc3154a1d9819e. Final log: /var/tmp/native-final3.log. Machine proof: scripts/t3-v2-production/artifacts/native/proof.json.
- Real evidence: execute-only model tool surface; real shared MCP registry and real continuation queue/worker; async launch+live inspect+paginated list; nested cancel descendant; idempotent repeated child stop; completed sibling preserved; parent handoff wake produced exactly one consumed result transfer; unique parent/child credentials; identical execute intent replayed in the restarted parent run and projected once with zero duplicate children; four exact provider PIDs all reaped; loopback listeners; isolated HOME/temp; zero root-prepared surplus child session files (four legitimate T3 Pi backing sessions for four spawned provider processes).
- Removed raw/debug evidence prints, external result write, PID debug hook, and unconditional fake restart literals. Failed tests cannot emit proof. Acceptance evidence fields now derive from asserted projections/requests/process/session observations. All /var/tmp acceptance fixture directories cleaned.
- NativeDieIntegration.production.test.ts has zero TypeScript diagnostics in /var/tmp/native-tsc-final3.log. Whole server typecheck still has 6 unrelated concurrent ProviderSessionManager.test.ts Effect diagnostics. No owned diagnostics. Root tsc clean at /var/tmp/root-tsc-native.log.
- Root source hardening retained in src/tasks/t3-native-task.ts: sanitized structured rejection handling recognizes the complete current OrchestratorMcpFailure code set without exposing backend messages. Exact reviewed binary was not replaced; final PASS used SHA 8fd3... unchanged.
- Post-format rerun also PASS: /var/tmp/native-final4.log; proof.json refreshed at 07:43Z.
