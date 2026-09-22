# Structured subagent workspaces — implementation in progress

Scope: optional structured workspace + title; inherit remains default. CLI uses local Git and t3.json setup; web retains native delegated task ownership and existing configured action. No cleanup UI, branch reset, automatic PR, sidebar changes, or parent followup synchronization.

Ownership:
- task_e8a923f5: root local/schema/routing source and unit tests.
- task_29bb57ca: canonical a9b49a7d backend source/tests + web/t3.patch export.
- Integration worker: isolated deterministic actual backend/PiAdapter/Die harness.
- Coordinator: prompts/public docs, canonical build, combined gates/review.

No commits, installs, live user server/state changes. Existing uncommitted production work is retained. Validation and exact build identity pending.

## Main prompt review received
Read .agents/notes/worktree-prompt-review.md (task_50180e82 complete). Established style: exact API and observable setup/limitations in execute.md; one short judgment sentence in main-orchestrator.md and orchestrator.md (independent code/PR->worktree; research/shared edits->inherit); no giant rules or hidden TS prose. Verify actual assembled prompts/custom overrides via offline prompt preview+targeted tests after schema final. No unresolved user product decision found by reviewer.

## Main PR readiness findings / user question (12:00Z)
Read .agents/notes/native-workspace-pr-readiness.md. Scope audit flags fixedpath .github CI/release references old .cache/die-t3code while new builds revision-keyed; main assigns exclusive workflow fix separately, do NOT edit .github concurrently. Implementation coordinator please own remaining harness fixes: source/config/patch defaults must canonical web files not .agents/patches or candidate dir; portability use os.tmpdir/TMPDIR (our runs TMPDIR=/var/tmp); packaged-smoke ws undeclared transitive dependency replace with existing built-in; public docs selfcontained canonical reproduction no essential excluded research/generated artifacts. No hide historical experiments format issues by blanket ignored production patterns; main will check final staged clean checkout.
Open USER QUESTION sent by main: should CLI worktree setup auto-run t3.json command or confirm first? Main recommends existing project-trust decision (already-trusted project automatic, no new approval store/framework). Don't invent trust approval fields or new config flow. Verify existing trust can be reused and flag if technically impossible. Keep setup policy provisional until user answers; can continue Git/workspace/native lifecycle/CI work safely.

Main assigned task_08406a1a exclusive .github/workflows/ci.yml + release.yml (optional new t3-web-test-list helper), no shared builds/source changes. Feature owner retains all other scripts/docs/backend/root. CI worker will add stable focused native lifecycle/resource tests and revision-keyed path selection. Report native-workspace-ci-fix.md.

## Incremental validation / review

Prompt recommendations from read-only audit applied: execute signature/API/setup facts, one isolation judgment sentence in each orchestrator role; no assembly-source changes. 20 focused prompt tests / 202 assertions pass, including actual offline Pi assembly and custom base/append preservation. Captured assembled orchestrator input: /var/tmp/worktree-prompt-orchestrator.json (networkRequests=0). Public docs draft: docs/subagent-workspaces.md; final behavior reconciliation pending.

First integration review flagged local preparing ownership/wait budget, batch failure IDs, native batch pinning and explicit ref validation for review before calling implementation complete. Independent local read-only review task_d0236c9d underway. Live harness initial code written; real run awaits coherent source+exact build.

CLI initial worker finished 36 focused tests, but integration review found blocking ownership gaps; task_9f55264e now owns corrective implementation, not acceptance-ready. Harness initial type errors are newly introduced (not pre-existing); task_38394973 owns correction and setup fixture completion. Backend task_29bb57ca still integrating. Canonical build intentionally not started while source contracts are unsettled.

## CI worker complete
Task_08406a1a finished .github workflow edits; main read diff. Revision-keyed source paths, package-local focused native/backend/contracts/client tests added, removed adapter test path corrected. Static YAML/bash/path checks pass only; actual new CI commands must be run in final validation before PR. No code worker owns workflows now. Setup trust user question still pending, no user answer received.

## Build constraint deviation observed

Backend worker invoked normal scripts/build.ts for its private dist/die-t3-worktree-native validation binary. Contrary to coordinator's no-install plan, that path ran pnpm install --frozen-lockfile in the canonical cache twice. Logs /var/tmp/t3-worktree-{build,final-build}.log show downloaded=0, reused=3, added=3, existing lockfile unchanged, and normal prepare hooks. No installed executable was replaced. This should not be described as "no dependency install"; coordinator will avoid further install steps. Main should review this deviation explicitly.

## Integration checkpoint (12:28 UTC)

CLI corrective worker completed 84 tests/413 assertions and typecheck. Coordinator additionally aligned optional native workspace result + uncertain status to backend, fixed lint issue, made title name the durable local session, recorded anticipated Git path before side effects, and stopped owned async setup if later session preparation fails. Added repeated prepare/fail/cancel teardown test. Canonical contract conformance now reads adopted a9b49a7d source, checks all preparation states and strict excess-field rejection; passes.

Root check and lint pass (historical experiment lint warnings remain). Full format check attempted: 21 historical experiments formatting failures, production scope format passes; no unrelated experiment sweep made. Live harness now uses FIVE-prompt default-base batches in both modes, not just explicit-OID individual calls.

Backend initial worker's finished source still did not implement immutable commit pin or bounded active preparation set. Corrective backend worker task_540583d0 owns those blockers and canonical patch export; no more build/install is authorized to that worker. Final exact bundle/build/live acceptance still pending.

Corrective backend worker finished canonical patch 9e94ef5e... but left canonical root node_modules absent after an aborted pnpm dependency-check attempt. Its focused tests did not execute (registration errors). Coordinator verified canonical and previous production cache pnpm-lock.yaml hashes identical (dc4461a4...), restored the already-installed dependency tree by local reflink copy (no package-manager install/hooks/network), and is rerunning build/tests with dependency auto-verification disabled.

## Canonical backend integration gate

Coordinator removed corrective worker's detached polling watcher entirely. Native observation now asks the existing scoped ThreadLaunchService preparation reservation; no second active-ID registry or timer/fiber is introduced. Existing prepare reservation fences concurrent requests and releases at preparation end. Corrected a malformed it.scoped test registration that had prevented the worker's focused tests from running (not merely a dependency-topology issue).

Server typecheck passes. 49 focused backend tests pass across DieTaskService, ThreadLaunchService, MCP integration and registration; GitVcsDriverCore suite passes. Reproducible script scripts/t3-v2-production/export-worktree.ts now exports through isolated index, archive cleanapply and byte comparison. Current patch SHA256 0c6e8cb18f2e8954eb78cb8d9c34b212345c1c36b1872823b8338acaa6262b2e (95 paths). No-install exact final build underway.

Packaging clarification: the coordinator recipe omits an explicit pnpm install, but retained normal pnpm deploy to assemble the relocatable runtime. Deploy resolves/copies cached dependencies and invokes the repository prepare hook; logs show downloaded=0. Thus "no-install recipe" means no install command and no installed executable changes, not zero package-manager packaging/hooks. Main should review that constraint interpretation alongside the earlier worker deviation.

## Exact packaged validation underway

Final current canonical patch SHA256: 4a26cc2556de4cf371bea6b13b5bba4c9fef1f05502f258fdff35bf12ac41bc3. Exact executable dist/die-worktree-production SHA256: c830d203b72a951a4df512b9db67fa1740a4026f69ed23ec61bc3c1b984b0a7f. Built from a9b49a7d + canonical exported patch; receipt dist/worktree-production-build.json. This supersedes earlier intermediate hashes. Root dist/die and installed executable remain unchanged.

Running: full root suite in /var/tmp/die-worktree-root-suite-5EfiZ7 with an exact copied executable (private HOME, unprivileged offline fixture context); five-child actual backend/PiAdapter/Die worktree harness; exact packaged security/relocation smoke; shell-completion preservation gate. Logs /var/tmp/worktree-{root-full-tests,live,packaged,preservation}.log. No success claim until these finish.

## Validation checkpoint (13:04 UTC)

Full root suite initially found two inherited-launch lifecycle regressions plus two fixture-copy omissions (.github). Fixed product by keeping inherited launches on their established spawn/wait/failure path; only requested worktrees use reserved preparation lifecycle. Refreshed owned copy including .github. Final full root suite: **737 pass, 14 expected skips, 0 fail**, 4689 assertions, 751 tests/100 files, exact copied final binary.

This root fix changes final executable hash to **2ee093e1928fc1e12d67423c14fa01857ed962582532695063f2499678520e29**; canonical patch remains 4a26cc25... . On THAT SAME final hash, native actual PiAdapter/Die acceptance, packaged relocation/security smoke, and old local-shell completion race/preservation gate all PASS. Proofs artifacts/worktree-native-acceptance/proof.json, artifacts/worktree-packaged-smoke.json, artifacts/worktree-preservation-acceptance.json.

Structured worktree browser harness blocked only on invented Project actions selector before any child launch; live worker task_1feca0bb now seeds real existing user-configured setup actions through private settings, not a mocked backend, and is rerunning actual five-child workflow. Product remains gated on its pass.

## Feature file ownership (root)

Runtime: src/tasks/worktree-workspace.ts (new), job-service.ts, task-manager.ts, agent-session.ts, t3-native-task.ts; src/typescript/job-bridge.ts. Prompt sources: src/prompts/execute.md, main-orchestrator.md, orchestrator.md (assembly implementation unchanged). Tests: tests/worktree-workspace.test.ts (new), agent-session.test.ts, task-manager.test.ts, t3-native-routing.test.ts, t3-production-bridge.test.ts, fixtures/t3-native-task-contract.json, prompts.test.ts, prompt-preview.test.ts. Tooling: scripts/t3-v2-production/{worktree-acceptance,export-worktree,contract-conformance}.ts. Public docs: README.md, docs/subagent-workspaces.md (new), docs/system-instructions.md, docs/t3-v2-delegation-status.md. Canonical backend source is reproducibly represented in web/t3.patch, preserving prior native T3 work. Backend functional integration centers on DieTaskService, OrchestratorMcpService, Orchestrator, ThreadLaunchService and orchestration/MCP contracts, plus their test/service wiring and Git collision test.

Limits to document honestly: validation is Linux x64/Git in isolated non-bare repositories; not cross-platform proof or submodule readiness claim. CLI worktree tasks retain existing in-session TaskManager semantics and do not introduce general crash/restart job recovery; no implicit setup retry is performed. Native crash uncertainty is explicit and does not rerun setup. Retained worktree disk use is intentional, not a leak. Background setup intentionally can outlive provider completion and remains separately inspectable/cancellable.

## Live-discovered terminal blocker (13:31 UTC)

The five-worktree live fixture passed all core cases on hash2ee..., BUT required shortening its setup script ID and reusing a short parent thread to avoid a real ENAMETOOLONG terminal-log filename bug for ordinary async setup on longer/nested delegated IDs. This is relevant to requested worktree setup, not an acceptable unrelated dodge. Backend task_ceee4aaa now makes terminal log identity bounded/stable with regression coverage. Coordinator restored ordinary native-acceptance-setup ID and fresh-thread background/missing phases in harness; full final same-hash gates will rerun after patch/export/rebuild.

## Parallel user-requested model default fix (13:37Z)
User reports new session loses selected model; asks last-used model retention. Main assigned task_a6734688 normal (60m) isolated source/patch only, NO shared canonical/root edits. Report .agents/notes/last-used-model-fix.md, deliver incremental .agents/patches/last-used-model-incremental.patch vs recorded current canonicalhash. Preserve explicit overrides, existing-thread models, profile/mode independence; last explicit user selection not internal reroute/child profile. Feature coordinator retain workspace ownership and finish tests; main integrates model patch afterward and reruns relevant gates. No overlap on shared checkout/patch/index. Include model bug fix in combined PR after review. CLIsetup trust question still unanswered by user; new model request is not answer.

## Final workspace handoff (13:46 UTC)

Terminal filename fix exported and rebuilt without installation. Canonical HEAD a9b49a7df0a4261dcc438d4493cc3154a1d9819e; final web/t3.patch SHA256 62d76004e90bb4b95ca7b1477049f1a9f0c149ccc9eb2ca5280ac32c6f47bbf0. Repeated private-index export reproduces this hash and clean-applies all 95 paths. Exact executable dist/die-worktree-production SHA256 a8358fd268fbcbb259e2440d69ce8e6037edd5020099032d4a120471a286b6a4; manifest dist/worktree-production-build.json.

FINAL SAME-HASH evidence: structured worktree LIVE acceptance PASS (artifacts/worktree-acceptance/proof.json), native actual backend/PiAdapter/Die PASS (artifacts/worktree-native-acceptance/proof.json), packaged smoke PASS (artifacts/worktree-packaged-smoke.json), shell-completion preservation PASS (artifacts/worktree-preservation-acceptance.json). Worktree fixture uses ordinary long setup script/thread identities, no short-ID workaround. Local/native five-child batches, configured/missing/background/failed/cancelled setup and durable parent delivery exercised. Root isolated exact-binary full suite 737 pass/14 expected skip/0 fail, 4689 assertions. Root check, lint, production-scope formatting, contract conformance and git diff --check pass. Full backend 16-package typecheck passes. Terminal Manager regression 85/85 passes. Full repository format:check remains blocked by 21 historical experiment-file errors, not silently reformatted.

Implementation work complete; no commits/push/installed executable updates performed. Main retains final review/PR ownership, pending CLI setup trust user decision and separate last-used-model integration. Existing implementation reuses project trust (trusted runs setup, untrusted skips with explicit denial); no approval boolean/config framework added. Any model-fix integration changes canonical hash and requires its own rebuild/relevant acceptance. Scope/platform limitations and earlier cached-dependency installation deviation remain recorded above.
