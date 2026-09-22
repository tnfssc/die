> Superseded by [t3-v2-production-lifecycle-final.md](t3-v2-production-lifecycle-final.md): lifecycle blocker fixed, all concrete gates passed, canonical a9b49a7d adopted. Content below preserves earlier non-adopted investigation history.

# Active continuation — 2026-09-21 06:29Z

The preparatory-stage report below is historical. Production continuation now has
actual root native routing + backend die_task_* contract; scoped calls are no longer
a disabled stub. Canonical pin719a76ca remains unchanged pending integrated evidence.
Read **t3-v2-production-design.md** for authoritative decisions/assignments and
**docs/t3-v2-delegation-status.md** for current user-facing semantics.

Implemented: durable execute/call-index native launch, ACK/replay recovery, bounded
read-only metadata paging, backend credential/profile/model/thinking/depth policy,
subtree cancellation, native-only completion ownership, loopback no-auth/Origin
ports, independent mode/model, local shell cards, monetary own/subtree accounting,
Herdr headless guard, v0.4 synthetic migration and bundled runCli export repair.
Resource queue bounds and exact Pi process hard-stop/tombstone cleanup have landed
with focused tests; retry fairness/saturated-RPC progress is under additional review.

Current validation still in progress: real deterministic native acceptance and
restart/ACK/failure assertions, final native browser flow, clean exported patch +
full package/type/test/relocated smoke. No adoption/readiness claim yet. Current
root/backend schema conformance all4 PASS; last full root699pass/14skip predates
latest focused fixes and must be rerun. Latest focused native9pass/48assertions.

Detailed continuation evidence: backend/root/live/browser-live/preservation/
accounting/queue-resources/process-resources/migration notes. Replacement native
acceptance owner task_50ec7d48; retry fairness owner task_b09ff94f; reproducible
migration harness owner task_59b780ab. Resource worker stalled and browser wait
worker were stopped explicitly; those stops are not validation results.

---

# T3 v2 production integration — safe stage complete, NOT adopted

## Preservation inventory (initial)
- Canonical immutable pin + clean-applying web patch; no research/experiment/runtime dependency. Candidate checkout .cache/die-t3code-v2-production only.
- Die-only provider identity/defaults, RPC executable packaging, dynamic profiles/model/mode, execute-only tool surface; local CLI delegation unchanged.
- Loopback/no-auth and Origin policy, scoped backend credentials; never fall back to local subprocess delegation after authorized bridge failures.
- Existing task IDs/status/inspect/cancel/completion/watch, selective execute ACK retirement; translate remote identity once, dedup notifications.
- Disk-backed bounded history; completed output RAM budget; bounded captures; owned process teardown; terminal queues/backpressure; rotating logs; frontend cache/prompt cleanup.
- Child transcripts owned by T3 only; no duplicate Die child file. Nested lineage and stop policy require validation. Parent turn stop vs session teardown documented explicitly.
- Models/profiles, handoff, cost/history/compaction/memory must be preserved where supported; unsupported remote affordances must reject explicitly.

## Ownership
- Integration orchestrator (this session): root coordination, review fit, validation/docs/build integration; canonical adoption remains coordinator judgment.
- Web migration orchestrator (launching): exclusive web/t3.patch, web/t3-source.json, new candidate checkout; may delegate nonoverlapping upstream areas. Port inventory and resource fixes, real backend tests.
- Root delegation worker (launching): exclusive src/tasks, src/execute integration plus new bridge modules and focused tests; no web patch edits. Use scoped T3_MCP_URL/T3_MCP_BEARER_TOKEN from backend and current execute subagent/jobs surface, no generic parallel orchestrator.

## Safety
No release/version/tag/push/install. Existing caches/sessions/servers untouched. Historical experiment protected assertions unchanged. New tests temp state only; do not kill unowned processes.

## Gates / gaps
All implementation and migration gates pending. Prototype is evidence only, not production proof. Read independent t3-v2-production-requirements.md and t3-v2-production-resource-review.md as they arrive.

## 04:50Z progress
Workers task_22bbfa03 (web migration) and task_aa90e5c7 (root delegation) running. Backend/root interface decisions in t3-v2-production-interface.md. Root execute implementation is src/typescript/** (clarifies initial src/execute label). Build integration now uses revision-keyed default cache (preserves stale checkouts) and disposable-index verification of exact HEAD + canonical patch, rejecting additional tracked/untracked source without modifying checkout index. Focused new test passes (1 test, 5 assertions). Canonical pin/patch unchanged pending coherent migration.

## Lead review gate — requirements auditor complete
READ .agents/notes/t3-v2-production-requirements.md (task_12c8ff2d) before accepting root/native bridge. Immediate P0 review on IN-PROGRESS t3-task-backend.ts: upstream delegate_task role enum differs from Die profiles; target.profile/thinking/cwd/depth/parentTaskId are not upstream fields (verify exact frozen schema). Parser must preserve summary/latestTerminalSummary, childThread/run/node/transfer identity. Fresh random idempotency key per retry cannot replay response-loss safely. Per-job 1s polling swallowing all errors is not truthful durable status; shutdown must settle ownership/cancel policy before map/client cleanup. Use exact upstream schema/service integration tests, not permissive mock. Findings against concurrent draft may be already fixed; track disposition and actual evidence for each, no blanket acceptance.

## 04:59Z audit checkpoint
Read independent production-requirements matrix; it identifies serious root-helper contract/ACK/profile/lineage gaps in work-in-progress. Added explicit adoption blockers to interface notes. Canonical remains old pin. New browser worker task_bebccfec owns scripts/t3-v2-production only; preparing honest same-live-server proof, no copied DB. Resource auditor findings still pending.

Build-source verifier also passed against untouched current .cache/die-t3code-v0042 and canonical patch. Focused biome check passed with informational pre-existing string-concatenation style notices; no errors.

## 05:03Z safe-stage decision
Root worker completed: unsafe speculative remote TaskManager adapter removed after exact-schema/ACK/resource audit. Product routing now deliberately refuses remote delegation (including partial credentials) rather than silently spawning local. Local CLI remains unchanged. Transport + focused existing suites: 38 pass / 0 fail / 238 assertions; root check passes. This is NOT completed T3 production delegation.
Transport followup task_078c0260 owns client/tests to address latent in-flight close, safe replay, reflected-secret errors and streaming SSE completion (independent resource review accepted). Browser harness worker finished static-only; no runtime PASS.
Canonical baseline full build attempted against prior checkout but verifier correctly rejected newly present untracked files before dependency/build steps; no old checkout mutations made. Fresh revision-keyed canonical checkout build now task_497eb34a, log /var/tmp/die-t3-v2-production-root-build-fresh.log. This validates retained shipped canonical baseline, NOT v2 candidate.
Web worker still migrating candidate; no canonical adoption authorized by evidence yet.

## Lead resource review gate — audit complete
Read .agents/notes/t3-v2-production-resource-review.md (task_e14133ad). Audit distinguishes current fail-closed stub from removed bad draft; previous requirements findings must not be reported as current bugs if removed. Before wiring current T3McpClient: fix close/in-flight initialization/body races (session learned after close can leak), enforce stable launch replay keys (no generic mutation retry on 400/404), endpoint transport safety, explicit intended capability scope. Do NOT call generic internal API automatically a privilege escalation: resolve intended agent permissions; narrow delegation token if bridge intended only delegation, enforce scope server-side not guidance.
Upstream reachable resource hazards to test/resolve when adopting: PiRpc incoming/outgoing queue aggregate, per-subscriber provider queues, terminal pendingProcessEvents producer backlog, continuation queue+per-retry sleeping fibers on failures. ProviderSessionManager removes map entry before detached scope closes; 30s timeout does not guarantee process exit. Need wedge-finalizer real process test and owned hard-stop path/tombstone if reproduced. Source-confirmed possibility vs runtime proof must stay separate. Preserve existing v0.4 bounds/history/process guarantees. No readiness claim until repeated lifecycle/backpressure/error/shutdown tests prove cleanup. Auditor provides concrete test matrix.

## 05:07Z validation checkpoint (safe stage/current canonical, NOT v2)
Fresh revision-keyed canonical checkout successfully clean-applied current patch, passed backend typecheck/frontend+backend bundling/deploy, and compiled dist/die. Isolated copied binary with empty env/private HOME/PATH=/nonexistent: --version 0.4.0, --help and web --help all exit0. Full root deterministic tests task_261d6a75 running. Full lint passes (warnings/info include preserved historical experiments). Full format check fails on 22 files, predominantly historical experiments; no historical protected evidence reformatted. One new browser harness format issue fixed separately.

## 05:09Z full root suite
Current safe-stage root plus current canonical compiled web: 683 pass, 14 paid/live skip, 0 fail, 4,468 assertions, 97 files (82.8s). Log /var/tmp/die-t3-v2-production-root-tests.log. This predates final transport followup, which requires rerun. Added docs/t3-v2-delegation-status.md with concrete ordered backend/ACK/lineage/cancellation/resource/adoption plan and explicit NOT enabled/NOT production-ready status.

## 05:12Z web candidate disposition
Web worker finished 30-path migration;218 selected tests+5 terminal/ws pass, frontend/backend bundles pass, full server typecheck non-clean. It wrote canonical pin/patch although root unavailable and preserved-UX/ownership gates unresolved. Coordinator exported exact bytes/hash to .agents/patches/t3-v2-production-{candidate.patch,source.json}, then restored canonical web files to original HEAD719a76ca. No migration work lost; candidate is NON-ADOPTED. See appended web-note disposition for remaining actual preservation gaps.

Final scope formatting: all 200 src/scripts/tests files pass. Full repo format fails exclusively on21 preserved historical experiments/t3-v2 files; detailed list in /var/tmp/die-t3-v2-production-final-format-full.log. Full root lint and typecheck pass. Candidate source exact HEAD+exported patch verification independently passed after export.

Final candidate typecheck recheck: full workspace pnpm typecheck now PASS (all15 packages, 0 cache hits); direct server check also PASS. Log /var/tmp/die-t3-v2-candidate-workspace-typecheck.log. This supersedes the earlier unexplained failed run as the latest check result, but does not resolve missing delegation/security/UX/resource acceptance. Canonical remains unchanged.

## FINAL implementation handoff — safe stage, NOT production adoption

All implementation workers finished. Native T3 delegation remains intentionally unavailable under scoped credentials; ordinary CLI/current web local delegation unchanged. Canonical web/t3-source.json + web/t3.patch are byte-identical to original HEAD719a76ca files. NON-ADOPTED v2 migration is preserved independently.

### Exact implementation outputs
- scripts/build-web.ts: revision-keyed default checkout and exact canonical patch input verification.
- scripts/web-source.ts + tests/web-source.test.ts: disposable-index verification (does not mutate checkout index), rejects unreviewed tracked/untracked source.
- src/tasks/job-service.ts: fail-closed scoped-context routing guard; no remote fallback.
- src/tasks/t3-mcp-client.ts + tests/t3-production-bridge.test.ts: preparatory bounded authenticated MCP transport; allowlist/idempotency-key gate, isolated caller/owner cancellation, bounded session close, streaming SSE, sanitized errors, 16 transport/routing tests. No native TaskManager adoption or remote polling registry remains.
- scripts/t3-v2-production/browser-acceptance.ts + README.md: gated, UNEXECUTED same-live-server browser harness, statically checked only.
- docs/t3-v2-delegation-status.md: behavior, concrete remaining implementation/adoption order and commands.
- .agents/patches/t3-v2-production-candidate.patch + t3-v2-production-source.json + t3-v2-production-README.md: immutable v2 candidate and reproduction commands, expressly not canonical. Patch SHA2561782dd0a5979c5457718ebc0584cf44d19a53ffe7540f21459ffe12c449b9156.
- Coordination/handoff notes: this file, t3-v2-production-interface/root/web/transport/browser.md and .pending/t3-v2-production-active.md. Independent requirements/resource-review notes belong to main coordinator's auditors, not implementation authors.

### Final evidence
- Root full build from fresh revision-keyed canonical checkout: PASS. Backend validation, frontend/backend build and standalone Bun compile executed; no reuse-web shortcut. Final logs /var/tmp/die-t3-v2-production-final-build.log.
- Root full tests after final build: **692 pass /14 paid-live skip /0 fail**,4500 assertions,97 files (85.64s), /var/tmp/die-t3-v2-production-final-tests.log.
- Root check + full lint: PASS. Scope format src/scripts/tests: PASS (200 files). Full format: **FAIL21 historical experiments/t3-v2 files only**, preserved byte content; see final-format-full.log. No historical assertions repurposed.
- Final copied binary empty environment/private HOME/PATH=/nonexistent: version0.4.0, CLI help, web help PASS. SHA2562b93aa5a0282d69b980e4e3c6b2a936b4032293d44b86d6533cb7e7603ddd65f. This embeds CURRENT719 web, not v2.
- V2 candidate selected checks: worker218 provider/resource/frontend tests +5 terminal/ws tests PASS; web/backend bundles PASS; coordinator exact patch verification PASS. Final full upstream workspace typecheck rerun: all15 packages PASS (0 cache hits), superseding initial unexplained failure. Log /var/tmp/die-t3-v2-candidate-workspace-typecheck.log.
- V2 runtime/browser/restart/nested closure/resource soak/packaged native delegation: **NOT RUN / NOT PROVEN**, no production-ready claim.

### Blocking work / adoption judgment
Authoritative profile/depth/capability scopes; durable launch identity; single delivery/ACK owner and native job metadata; parent Stop vs child closure policy; no-auth/Origin startup and local shell cards; complete PiV2 session/history/compaction/cost/Herdr preservation; bounded upstream producer/subscriber/continuation queues; restart/ACK fault matrix and meaningful resource soak; same-live-server browser and packaged runtime acceptance. Ordered plan in docs/t3-v2-delegation-status.md. Main coordinator owns final judgment. No release, version bump, tag, push, install, user session overwrite, or unowned process termination performed.
