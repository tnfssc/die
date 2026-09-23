# T3-v2 production browser live acceptance

## 2026-09-21 initial audit / executable request

Browser owner audited the current root and upstream candidate. The candidate checkout is still a live dirty worktree at `.cache/die-t3code-v2-production` HEAD `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`; root fails closed for scoped delegation in `JobService`, so it is not yet executable acceptance input. Do not build/adopt from this observation.

Coordinator handoff needed after implementation workers settle: publish the exact absolute candidate executable path, its SHA-256, the exact candidate checkout path/HEAD, and confirm the executable was built with that candidate worktree. Browser owner will independently recompute all identities and content hash. The harness does not install, build, mutate canonical pins, or choose source inputs.

Harness/current-candidate audit findings:

- Fresh state location matches Die launcher: `$HOME/.die/web/userdata/settings.json`; candidate Die Pi adaptation forces the supplied exact binary.
- Current route/relationship and Stop-generation selectors exist in the v2 UI.
- Parent completion must be asserted exactly once, not just observed once. This harness is being strengthened to reject duplicate wake model turns and unexpected deterministic-model routes.
- Teardown needs evidence for exact backend/browser descendant PIDs, not only a process-group signal. The harness is being strengthened to record its process trees and verify every observed owned PID exits before deleting temp state.
- The model fixture will reject bridge credentials/internal MCP environment appearing in model payloads.
- Functional gate remains: real parent execute calls native `subagent`; running real child route opens; terminal completion triggers exactly one parent continuation; second real child cancels in browser; exact stopped route/transcript/status survives reload. No seeded projection/database and no experiment runtime path.

Review tests that can run before a coherent build: Bun compilation of this browser harness and root focused bridge tests. Actual PASS is forbidden until exact coordinator build handoff and browser run.

## Pre-candidate checks

- PASS: `bun build scripts/t3-v2-production/browser-acceptance.ts --target=bun --outfile /tmp/t3-v2-browser-check.js`.
- PASS: `bun test tests/t3-production-bridge.test.ts` (16 pass). This now covers transport/fail-closed behavior, not functional native routing.
- PASS: `bun test tests/web-source.test.ts` (1 pass).
- PASS (negative gate): running with `T3_V2_ACCEPT_CANDIDATE=0` failed before temp allocation/process spawn with the intended coherent-candidate error.

browser functional run has not happened yet; exact executable handoff is still required.

## 05:34Z contract adaptation

The functional root/backend contract is now visible but still in progress. Root makes scoped native launch unconditionally asynchronous and intentionally rejects any explicit `waitSeconds`. I removed `waitSeconds: 0` from both fixture launch calls. This does not weaken running-state assertions because launch returns only `background: true` and the child has a 12s/120s deterministic running window. The browser still must open the real child while its execute tool is live. Did not change wire/backend source.

## 05:46Z coordinator contract correction

Coordinator review takes priority over the transient root implementation: explicit `waitSeconds: 0` is the documented async API and must work. Only positive foreground waits may reject. Restored `waitSeconds: 0` in both browser fixture launches and README. The temporary 05:34 adaptation was never run against a candidate and is superseded. This preserves the requested/documented caller shape and remains an async live-child assertion.
