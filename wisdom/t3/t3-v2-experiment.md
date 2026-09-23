# T3 orchestration-v2 experiment — final report (2026-09-20)

## Verdict

**The isolated prototype is done. The full integration goal is NOT yet proven. Do not adopt it yet.** Root product code, the shipped pin and patch, binaries, and installed state did not change. There was no release, commit, or push. Tests used isolated state and projects, and did not touch current sessions. The main coordinator must review it.

Deliverables include `experiments/t3-v2/README.md` for launch and reproduction, `RESULTS.md` for the result matrix, setup/run/combined-probe scripts, the execute bridge client/extension/launcher, focused tests, `upstream.patch`, four worker reports, the protected baseline/audit, and local regression proof. The patch records research-only edits. It adds reconnect and idempotence assertions to the real v2 integration test. Combined-probe.sh tracks and stages the kept diagnostic instead of leaving an untracked upstream-only artifact.

## Results

- **PASS** real upstream v2 services with mock Codex/Claude providers: delegate_task creates durable child thread/run/graph. Terminal result/status/context transfer and parent delivery. Cancel interrupts child and disposes delivery. Reconstructed authenticated invocation scope recovers status. Stable clientRequestId replay creates no extra execution. Coordinator rerun: 1 pass / 1 filtered skip, 14.60s.
- **PASS** actual dist/die RPC with deterministic loopback model and explicitly mocked HTTP MCP: sole visible execute imports experiment bridge, delegate_task called exactly once, result returned to parent continuation, bearer absent from captured RPC. No local subagent spawn in bridge.
- **PASS** bridge/client/isolation tests: 6 tests, 22 assertions, final rerun 678ms. Includes status/cancel over fresh clients, unauthorized rejection, redirect rejection, non-T3 activation inert and launch guards. Focused TypeScript check passes.
- **PASS** upstream PiAdapterV2/injection suites with fake process boundary: 51 tests. Independent rerun 2.25s.
- **PARTIAL/FAIL** actual PiAdapterV2 + Die combined probe: real openSession/ensureThread reached child RPC. But prompt terminal lifecycle and real-child Effect finalizer did not settle (45s prompt attempt. 15–20s reduced case). Reproducible reduced diagnostic independently exits 124 at 20s. Not evidence of real engine-owned delegation through PiAdapterV2. Final process scan found no remaining diagnostic Die subprocess.
- **PASS** isolated live backend, migrations through 54_OrchestrationV2, normal auth-required startup and UI HTTP 200. 16 UI component/timeline tests pass. Independent rerun 2.15s. Loopback UI 24733/backend 32773, servers stopped.
- **BLOCKED** rendered browser child transcript/navigation: Firefox SWGL framebuffer initialization failed in two bounded attempts (25/35s). No screenshot or interactive proof. No system/browser install or auth weakening.
- **NOT RUN** real model/paid smoke. No provider credential contents read/printed/modified. Component peers deterministic. Mock results are not model evidence.
- **PASS** existing local CLI regression: 65 tests / 3 files, 252 assertions. Protected hashes for web/t3-source.json, web/t3.patch, dist/die unchanged. src/web/dist have no new modifications.

## Minimal bridge and ownership

No root change was necessary to expose delegation FROM execute. The experiment launcher keeps PiAdapterV2's injected extension (approval/lifecycle hooks), adds before_agent_start guidance with an absolute import path, and keeps execute alone visible. Bridge-client.ts inherits T3_MCP_URL/T3_MCP_BEARER_TOKEN and exports delegateTask/taskStatus/taskCancel using session HTTP MCP. T3 owns child creation. The helper has no local spawn path. Stable clientRequestId is required for safe replay. General-purpose local subagent() is still available for unrelated CLI behavior. Strict enforcement against a model ignoring guidance is still future policy work.

## Reproduce / next work

See experiments/t3-v2/README.md. Core commands: setup.sh. Run.sh test-harness. Run.sh test-ui. Bun test the three bridge/client/isolation suites. Audit-isolation.ts. Run.sh dev uses isolated HOME/XDG/T3 state and separate loopback ports with standard pairing. Combined-probe.sh is deliberately expected-failing and bounded.

Resolve adapter subprocess/scope teardown and connect the real MCP session credential + generated extension + execute bridge to real Orchestrator-v2 lifecycle in one test. Then verify UI Open subagent thread and actual transcript/result, cancellation and network reconnect using a functioning browser. A real bounded model smoke can follow. Scope reconstructed-session replay is not full server restart recovery. Finally assess broad shipped v0.0.42 patch rebase/migration, Pi tool permission semantics, provider model catalog, and robust protocol/session error behavior before adoption.

---

## Progress log

2026-09-20: Started isolated experiment under experiments/t3-v2/. Read synthesis and linked reports. Baseline unchanged. No adoption/release. Delegated bridge, real-upstream deterministic lifecycle harness, and setup/UI work to separate workers. Deliverables must be tracked, not research-checkout-only. Main coordinator will review any proposed product changes before adoption.

Pending: executable integration evidence, exact matrix, launch instructions. Mock provider proof is not real model proof.

16:48 UTC: Protected-artifact audit passes for shipped source pin, patch and dist/die. Unmodified local behavior regression: 65/65 tests pass across subagent-extension, typescript-execution, typescript-runner. No model calls made. Workers implementing isolated runnable probes.

16:56 UTC: Real upstream service-level harness passes in isolated rebuilt checkout: delegate/status/result/graph/cancel, durable clientRequestId replay and reconstructed authenticated invocation scope. Only provider boundary mocked. Initial actual Die RPC probe passes. But exposes MCP beside execute rather than FROM execute. Coordinator explicitly requested corrected importable execute bridge. Combined PiAdapterV2+Die probe now assigned, to avoid conflating independent component passes with E2E. Setup dependencies installed inside .runtime. No paid model calls or root product edits.

16:57 UTC: Isolated live server and UI asset smoke PASS, authentication required, migrations through 54. UI 24733/backend 32773 loopback, stopped after test. 16 UI unit/component tests PASS, independently rerun by coordinator. Rendered Firefox attempts BLOCKED by SWGL framebuffer initialization (no child navigation/browser E2E claimed). Added launch hardening: reject nonnumeric offsets before arithmetic and prevent override of host/state flags. 2 isolation tests PASS. No shipped changes.

17:02 UTC: Corrected execute-only bridge PASS with actual dist/die RPC and deterministic peers: execute imports bridge-client, calls delegate_task once, continuation sees result, bearer absent from captured output. Added taskStatus/taskCancel helpers, retry clientRequestId guidance, redirect rejection and no-op activation outside T3. Combined 6 bridge/client/isolation tests pass. Focused TypeScript check passes. Real engine harness independently rerun PASS (14.60s). RESULTS.md captures boundaries. Full chain still pending combined probe and rendered UI blocked.

## IMPORTANT coordinator review findings — 17:14 UTC
Independent review complete: READ wisdom/t3/t3-v2-experiment-code-review.md before claiming combined real-server pass. Bridge-client.ts AND bridge-extension.ts omit mcp-protocol-version header required post-init by real upstream Effect MCP (upstream piT3McpExtensionSource.ts:136-140). Mock accepts it incorrectly. Fix with protocol validation test / real server. Local subagent is still callable: no duplicate local launch is only scripted guidance, not enforced. Keep results honest or gate local delegation in explicit experiment mode. One-shot helper sessions need cleanup. Clean setup/binary selection reproducibility findings too. Main not editing your owned implementation, please incorporate review fixes.

## Followthrough reviewed by lead — 18:05 UTC
See experiments/t3-v2/followthrough-progress.md, RESULTS.md, integrated-real-report.md. task_dfa3e5c8 completed. Lead independently reran integrated-process-proof.sh + 13 bridge-client/launch/isolation tests (38 assertions) + protected artifact audit, job task_d14d6aff exit 0. Real engine/auth MCP/PiAdapterV2/Die deterministic model proof: success child once, cancellation child interrupted/disposed, parent completed naturally, one result transfer acknowledged, 3 provider RPC+2 execute workers, zero local subagents in script, all provider PIDs reaped. Current proof IDs use scope 6be5ccee-7bfb-4def-857f-81387fb1a1a2.
UI worker previously showed Chromium parent->actual child+refresh using COPY of closed real-engine DB, NOT live same-server execution. Because lead rerun changes DB/IDs, task_1fcd49c1 now independently refreshing browser proof to match NEW current engine run, keeping old experiment-only state/profile. No implementation edits delegated.
Remaining gaps: simultaneous live browser+provider flow, fault-injected ACK/disconnect/server restart, real nested closure, enforced single delegation routing, clean no-binary build provenance. This is successful feasibility proof, NOT shipped/adopted. Root product source/pin/patch/dist unchanged.

## Coordinator final verification
Browser verification task_1fcd49c1 complete. Lead compared browser-live-proof.json parent/child IDs to current integrated-process-proof.json: exact match, refresh true, both markers count 1. Lead visually inspected browser-live-child-navigation.png: real child title, Subagent of parent, execute event and result, lineage navigation. Screenshot explicitly labels closed real-engine DB snapshot/provider stopped. Thus backend clean-path proof plus persisted-state GUI navigation confirmed, not same-server live streaming/adoption. All owned experiment servers/Chromium stopped (30733/38773 reported clear). No active experiment jobs. Next feature step is opt-in live prototype/routing enforcement, fault-window/nested tests, then production migration decision. Keep shipped backend unchanged until approved/validated.
