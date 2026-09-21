# Native T3/workspaces and model retention — final integration

Branch: feat/native-task-workspaces. Target: tnfssc/die develop.

## Scope and policy

Native T3 delegated-task ownership/continuations, structured inherited or isolated worktree subagents, reproducible pinned web source, and last-explicit-model retention for new web drafts are integrated. CLI t3.json runOnWorktreeCreate setup is automatic with no confirmation, project-trust, or approval gate; child-agent trust continuity remains separate. No version bump, release, installation of the executable, or user-state migration was performed.

## Identity

- Upstream revision: a9b49a7df0a4261dcc438d4493cc3154a1d9819e.
- Canonical web/t3.patch SHA256: 973b265252c61b33d056c51da8ce15d628f3fa7632fde31af63fd8e08399b686.
- Combined dist/die SHA256: 5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1.
- Private-index canonical export repeated twice: identical patch, 100 paths, clean apply verified.

## Executed validation

- bun run generate:notices: passed; no tracked attribution changes (133 production packages).
- bun run check after combined CLI/harness edits: passed.
- bun test tests/worktree-workspace.test.ts tests/prompts.test.ts tests/prompt-preview.test.ts: 23 passed, 187 assertions.
- Pinned-checkout focused model tests: 158 passed; full web unit suite: 407 files, 5415 passed.
- Pinned-checkout full monorepo typecheck: all 16 workspace projects passed (15 tasks; diagnostic suggestions remain).
- bun run smoke (includes normal bun run build): passed. Frozen dependency installation/deployment reused cache, ran prepare hooks, and did not replace the installed executable. Build reported peer-dependency warnings.
- Final clean staged-tree bun run format:check, bun run lint, and bun run check: passed exit status; lint has 274 warnings and 452 infos, not a warning-free claim.

- Full root `bun test ./tests` against the rebuilt dist/die, private HOME/XDG, DIE_RUN_LLM_TESTS=0: 737 passed, 14 expected skips, 0 failures; 4689 assertions across 100 files.

- Updated upstream CI selections executed: server 15 files / 257 tests (including 88 terminal cases), contracts 26 tests, client projection 9 tests, focused model 158 tests: 450 unique tests passed. Native integration is validated separately against the final binary. CI now explicitly gates focused model and terminal regressions; it does not run the full web unit suite.

- Same-binary contract, worktree, native backend/PiAdapter, preservation, browser, and historical migration gates passed. Private state and deterministic loopback fixtures were used; owned native/browser PIDs were reaped.
- Packaged relocation/security smoke initially failed twice: the new built-in raw WebSocket probe timed out on a same-origin upgrade after 10 seconds (reported status 0). Backend HTTP startup/migrations and other WebSocket-backed gates passed. Resolved by replacing the raw node:http upgrade with Bun’s built-in WebSocket client (no undeclared dependency). Same-origin and headerless probes opened (101), all four hostile Host/Origin cases failed to open, HTTP hostile cases remained unauthenticated. Exact-binary packaged smoke rerun passed. Prior failing logs were retained. Final staged-tree format/lint/typecheck were rerun after this harness-only fix and passed.

## Hygiene and caveats

Staging intentionally excludes experiments, bulk research notes, research-only build/export scripts, duplicate/rollback patches, caches, logs/proofs/screenshots/browser profiles, credentials and generated binaries. Local excluded files and the existing notes index delta are preserved rather than deleted. The clean staged-tree formatting check avoids unrelated historical experiment formatting errors without changing ignore rules.

Platform evidence is Linux x64 with ordinary Git checkouts; cross-platform cancellation and submodule readiness are not claimed. Worktrees/branches are retained intentionally. CLI tasks retain in-session lifecycle semantics, not general crash recovery. Native uncertain setup is not rerun implicitly. Native delegated runtime deadlines and input/watch/snooze controls remain unsupported as documented. No universal zero-leak or accounting claim.

## Publication

Committed as 9abdc41 (Add native T3 task workspaces and retain last selected model), pushed to origin/feat/native-task-workspaces.

PR URL: https://github.com/tnfssc/die/pull/1 (base develop).

Local required gates passed as recorded above; GitHub-hosted CI is separate and is not claimed passed. No release/install/version bump. Git index is empty after commit; the existing local notes index delta and excluded research files remain preserved.

## PR #1 GitHub CI correction (2026-09-21)

- Inspected `gh run view 35613927360 --log-failed` and `gh run view 35614002299 --log-failed` first. Both fail only NativeDieIntegration.production.test.ts (parent projection timeout; 257 other backend tests pass). Runs: https://github.com/tnfssc/die/actions/runs/35613927360 and https://github.com/tnfssc/die/actions/runs/35614002299.
- Root cause: integration fixture selected the built Die executable but did not set the backend's DIE_WEB_DIE_BINARY trust input. Clean CI denied native delegation (capability_denied), so the parent never reached its expected projection. Local acceptance commands supplied trust externally. The fixture also inherited developer subagent profiles, independently yielding model_unavailable instead of the deterministic fixture model.
- Focused correction in web/t3.patch only: resolve the binary once; explicitly configure backend/child trust; supply temporary empty subagent profiles; restore both process environment values on fixture release. Added parent/child die-delegation capability and depth assertions. No existing assertion, timeout, or CI gate weakened; no production trust policy, install/release/version changes.
- Reproduction: focused integration with trust/profile environment unset failed before fix; instrumentation exposed capability_denied. Corrected focused integration passed (1 test, 7.95s). Pinned-source server tsc --noEmit, formatter, verifyWebSource, canonical reverse-apply check and git diff --check passed.
- Independent clean checkout: /tmp/die-ci-clean-pr1-9abdc410, fresh root/upstream dependencies and no reused dist/source cache, isolated HOME/cache, Bun 1.4.1 / Node 24.13.1 / pnpm 11.10.0 matching CI. Frozen install, format, lint, typecheck and full build passed; exact pre-fix backend CI selection reproduced failure. Focused model, contracts and client projection suites passed. Fresh upstream download retries slowed build but it succeeded. Local host is CachyOS, not Ubuntu; actual GitHub validation remains authoritative. Logs/progress: /tmp/die-ci-clean-progress.txt, /tmp/die-ci-artifacts-35613927360, /tmp/die-ci-35613927360.log, /tmp/die-ci-35614002299.log.
- Existing .agents/notes/index.md modification and unrelated untracked research files preserved.

### Published correction and actual runs

- Commit: https://github.com/tnfssc/die/commit/d5ddd78f57d3bfc0735276361e35c2d9659d94ff
- Push run **passed all gates**: https://github.com/tnfssc/die/actions/runs/35616674459
- PR run passed the corrected backend, model/contracts/client gates but exposed a separate intermittent deterministic TUI timeout: https://github.com/tnfssc/die/actions/runs/35616678896 (`real TUI /ps selects live jobs and only stops the confirmed target`, 20000 ms). Its failed log and artifacts were inspected; investigation continues rather than treating a rerun as a fix.
- Clean-checkout final results: 258 backend tests passed; 193 model/contracts/client tests passed; root 737 passed / 14 expected skips; smoke passed. Corrected source static checks and server typecheck passed. Same-binary A/B: original fixture timed out, corrected fixture passed using executable SHA256 29515a25c67923baf52e0d834cd4c45b468100491c5523d0886ab2e71acf9220.
- Dependency-cache clarification: clean checkout had newly installed dependencies and no source/build cache, but pnpm reused external /tmp/.pnpm-store. Bun cache was isolated. Fresh GitHub-hosted build and full successful push run provide additional clean-run evidence; this is not a claim of zero package-download-cache reuse locally.

### Follow-up TUI fixture race

- Investigated `gh run view 35616678896 --log-failed` and downloaded ci-failure-logs. The PR run timed out in the /ps fixture while the simultaneous push run passed it.
- Found a scheduler-dependent fixture: ALPHA self-terminated after five seconds even though the test requires it to stay alive throughout inspecting/stopping BETA. A temporary five-second scheduling delay reproduced lost liveness (`No jobs are running`) before the change and passed afterward (13.95s). The GitHub timeout log has no captured frame, so it cannot prove the exact point of that timeout; this corrects the reproduced race rather than claiming direct evidence of the runner's missing frame.
- Minimal change: keep ALPHA active until existing TUI teardown, matching BETA's lifecycle. All selection, explicit confirmation, target-stop and other-job-liveness assertions and the 20000ms timeout remain unchanged.
- Validation: six concurrent focused runs passed (~8.8s each); complete test file 2 passed / 26 assertions; final focused test 1 passed / 20 assertions; format and diff checks passed. Lint retains two pre-existing quote-escape warnings. Independent pinned-tool clean-checkout rerun started with logs /tmp/die-ci-tui-fixed-clean.log and /tmp/die-ci-tui-fixed-full.log.

### Final correction validation

- TUI correction commit: https://github.com/tnfssc/die/commit/a12d1d24d9eb8396eed48d41ddb95053209e9a41
- Actual PR CI **passed all gates**, including backend integration, deterministic tests and standalone smoke: https://github.com/tnfssc/die/actions/runs/35618137099 (head a12d1d24d9eb8396eed48d41ddb95053209e9a41; monitored with `gh run watch 35618137099 --exit-status`, exit 0).
- Independently reran corrected TUI file and full root suite in the clean checkout with CI=true and pinned Bun/Node/pnpm: 2 tests / 26 assertions passed; format passed; root 737 passed, 14 expected skips, 0 failures / 4689 assertions. Commands: `bun test tests/task-monitor-tui.test.ts`, `bun run format:check`, `DIE_RUN_LLM_TESTS=0 bun test ./tests`. Logs: /tmp/die-ci-tui-fixed-clean.log, /tmp/die-ci-tui-format.log, /tmp/die-ci-tui-fixed-full.log.
- Concurrent commit f8b59b0dcfaa3bff370e1568d362081dddc04137 (CI deduplication) appeared during this work and was preserved; it is not part of either focused correction. Original unrelated notes-index delta and research files remain untouched. No install/release/version changes.
