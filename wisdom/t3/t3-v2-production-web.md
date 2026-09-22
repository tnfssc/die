# T3 v2 production web migration

**Owner:** web migration worker; integration coordinator disposition below. **Status:** NON-ADOPTED candidate exported to `.agents/patches/`; canonical pin/patch restored to shipped baseline. Overall production acceptance blocked.

## Scope and safety

- Exclusive outputs: `web/t3-source.json`, `web/t3.patch`, candidate `.cache/die-t3code-v2-production`.
- Immutable target `a9b49a7df0a4261dcc438d4493cc3154a1d9819e` from `719a76ca1dbf5490f1aa33ffb9966301e02be9a9`. Original `.cache/die-t3code-v0042` remains untouched.
- No release, installation, running shared server, or user-process effects. Experiments are evidence only and will not be runtime dependencies.
- Root worker owns Die execute/task bridge. This migration owns T3 backend injection and UI/provider integration.

## Progress

- Read product/resource guidance and initial production inventory. Independent resource review is currently still pending source findings; no requirements note exists yet.
- Audited canonical patch inventory: 73 files / 511,659 bytes. It includes staged provider/security/UX changes plus later resource fixes (event-log rotation, terminal subscriber bounds, RPC capture bounds, syntax cache, PR diff bounds, ws request cleanup).
- Fresh target checkout created without modifying the preserved v0042 checkout. Worker temporarily updated canonical pin/patch after focused tests and reset/apply proof; coordinator restored baseline because adoption gates were not met.

## Required integration contract with root bridge

- T3 backend injects scoped `T3_MCP_URL` and `T3_MCP_BEARER_TOKEN` only into the active Die provider process/session; credentials are not persisted or shown in UI/logs.
- Native model-facing `execute` helpers `subagent()` and `jobs.*` route delegated work to T3-owned threads when scoped MCP is present. No competing local child spawn/fallback after an authorized bridge failure.
- Preserve dynamic profile/model choice, stable remote/result identity and exactly-once ACK behavior, nested cancellation closure, and child transcript navigation. T3 owns delegated transcripts; Die must not create duplicates.

## Gates pending

- Source contract trace and preservation table against v2.
- Port and focused backend/frontend tests.
- Clean apply from immutable target plus build/typecheck/test evidence.

## Frozen upstream MCP contract (a9b49a7d)

- `delegate_task` input: `task`; optional `target { providerInstanceId?, driverKind?, model?, options? }`; optional `title`, `role` (implementation/research/review/design/test/general), `mode` (async/wait), `timeoutMs`, stable `clientRequestId`, `runtimeMode`, `interactionMode`.
- Die `profile` is **not** upstream `role`. This patch advertises `instructionMode` as a model option on every Die model. Root bridge should map the resolved `fast|normal|orchestrator` profile to `target.options: [{id: "instructionMode", value: profile}]`; `subagent()` defaults to `normal`, so do not omit that default and accidentally inherit the main `orchestrator` profile. An explicit model maps to `target.model`. Upstream `role` is a separate semantic task label and must not carry Die profile. Preserve/reuse one clientRequestId across response-loss retries.
- Delegate/status result identity must retain: `taskId` (parent node), `childThreadId`, nullable `childRunId`, `childNodeId`, status, `workState`, `hasPendingChildRuns`, latest terminal run/status/summary/transfer id, provider/model, stable summary/result transfer id, and `waitTimedOut`.
- `task_status {taskId}` is mutating in one narrow sense: reading a terminal result ACKs automatic parent delivery. Call it intentionally once for retirement/delivery; deduplicate by task/result-transfer identity. There is no separate await or ACK MCP method. Async completion is pushed through T3 parent notification; do not add 1s polling.
- `task_cancel {taskId, reason?, clientRequestId?}` returns cancel_requested or a terminal state. Upstream describes interruption of the active delegated task and disposal of automatic parent delivery. Closure over nested descendants is not promised by this schema; validation remains a P0 gap.
- Child navigation identity is `childThreadId`; T3 owns the child thread/transcript and parent `app_owned` subagent projection. Die must not allocate a duplicate child session file.

## Port disposition (current candidate)

| Baseline behavior | v2 disposition |
|---|---|
| Die executable/default provider and dynamic RPC model inventory | Ported on existing Pi V2 adapter; scoped env overrides executable and enables provider; startup defaults to Die provider. |
| Main fast/normal/orchestrator selector independent of model/reasoning | Ported as `instructionMode` descriptor and pre-user-prompt `/mode` RPC request. Focused tests/typecheck pending. |
| One model-visible execute surface | Ported injection branch: Die receives scoped MCP URL/token but Pi MCP extension is not registered. Ordinary Pi behavior remains upstream. |
| T3 child identity/result/ACK/navigation | Native upstream v2 contracts/projectors; root bridge must consume exact fields above. |
| Security | Scoped expiring MCP credentials retained. Current Die loopback no-auth + exact Host/Origin startup behavior is NOT verified preserved; upstream pairing auth alone is not an equivalent port. |
| Rotating bounded event logs | Already upstream with per-file/count/total-byte/age/buffer/record bounds; no old downgrade applied. |
| Terminal backpressure | Upstream OutputProtocol already bounds pending chunks/bytes; baseline frontend terminal-family eviction and PTY teardown patches applied. |
| Frontend bounded caches | Syntax highlighter and PR diff bounds applied from baseline patch. |
| RPC recovery and owned process teardown | Baseline focused patches applied; tests pending. |
| Old v1 local task cards | NOT ported. T3 app-owned projections replace native child cards only; local shell jobs still need their own visibility/Stop. This is a preservation gap. |

## Honest open gaps

- Nested cancellation closure and exact parent-stop policy need backend integration evidence.
- Browser refresh/navigation/result-ACK evidence waits for coherent root bridge + candidate build.
- Handoff/cost/history/compaction behavior relies on Die RPC + upstream Pi V2 paths and still needs focused regression runs.
- Upstream role vocabulary does not encode Die profile; the supported mapping is model option `instructionMode`, not `role`. The Pi adapter validates the option and performs the real `/mode` RPC before user input. As in the baseline product, delegation permission/depth remains behavioral instruction policy (fast/normal cannot delegate; orchestrator can within the documented two-level limit), not a T3 authorization boundary; no new server-enforced depth claim is made.

## Independent resource review disposition

- Preserved baseline terminal subscriber bounds by porting the bounded callback adapter into v2 `ws.ts`; overflow detaches only the slow subscriber and fails explicitly so clients reconnect from a fresh snapshot.
- The independent review confirms additional upstream-v2 unbounded producer shapes (Pi RPC event/outgoing queues, terminal manager pending-process events, continuation requests/retry fibers, provider-session subscriber queues). They pre-exist this Die patch and are **not proven safe** by the focused migration tests. They remain an honest production-wide resource gate; this patch does not claim bounded end-to-end delegation memory.
- Root bridge review currently reports fail-closed delegation and MCP-client lifecycle/idempotency/allowlist gaps. The web backend supplies the scoped contract, but browser/remote-cycle acceptance must remain blocked until root ownership is implemented and reviewed.

## Validation evidence

- Immutable checkout HEAD: `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`.
- Final patch: 30 paths, SHA-256 `1782dd0a5979c5457718ebc0584cf44d19a53ffe7540f21459ffe12c449b9156`.
- Focused provider/resource/frontend tests: 10 files / 218 tests passed (Die settings, Pi provider/adapter, scoped MCP injection, PTY adapters, syntax cache, PR diff bound, RPC recovery, host process).
- Terminal callback regression: `SubscriberStream.test.ts` + `ws.test.ts`, 2 files / 5 tests passed.
- Clean proof: candidate reset to immutable HEAD, `git apply --check`, apply, `git diff --check`, canonical `verifyWebSource`, and reverse-apply check all passed.
- Full workspace `pnpm typecheck` ran all 15 packages: 14 passed; server task exited 1 while emitting Effect diagnostic suggestions, with no `error TS` lines found in a focused server rerun. This is reported as a gap, not a clean typecheck claim.
- Patched frontend production build and backend bundle build both passed.
- No release/install/user process was performed. Candidate-local dependencies were installed only for tests/build checks.

## Final web-worker verdict

The web migration is internally coherent and clean-applying, and it preserves/ports the relevant provider, scoped credential, UX mode/model, security, log, terminal backpressure, process, and frontend cache behavior. **The combined T3 delegation feature is not production-ready yet**: root currently fails closed, nested cancellation closure is unproven, independent review identifies root MCP ownership/security and upstream queue bounds, and same-live-server browser acceptance has not run.

## Coordinator disposition (supersedes canonical/ready implications above)
The worker wrote canonical pin/patch despite the combined feature remaining blocked. Integration coordinator preserved those exact candidate bytes in .agents/patches/t3-v2-production-candidate.patch + source.json and restored canonical web files to original HEAD719a76ca. No work was discarded. The candidate is **not adopted**. Stronger upstream auth does not prove existing loopback no-auth startup preservation; T3 native child projections do not replace local shell task cards; mode option/preflight does not enforce authoritative child profile/depth; unchanged Die RPC alone does not validate PiV2 session leases/history/compaction. These remain concrete regressions/gaps beyond the worker's optimistic internal-coherence verdict. Full server typecheck is a failed gate, not a warning-only pass.

Coordinator recheck: direct candidate apps/server pnpm typecheck now exits0 (Effect suggestions only), log /var/tmp/die-t3-v2-candidate-server-typecheck.log. Earlier workspace failure is not reproduced by this isolated rerun. Full workspace recheck launched; candidate remains unadopted regardless of typecheck.

Final candidate typecheck recheck: full workspace pnpm typecheck now PASS (all15 packages, 0 cache hits); direct server check also PASS. Log /var/tmp/die-t3-v2-candidate-workspace-typecheck.log. This supersedes the earlier unexplained failed run as the latest check result, but does not resolve missing delegation/security/UX/resource acceptance. Canonical remains unchanged.
