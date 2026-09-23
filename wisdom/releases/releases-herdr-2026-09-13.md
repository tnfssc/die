# Releases and Herdr sidebar investigation (2026-09-13)

## Current status
v0.2.8 is published and checked. Every job named here is finished. Herdr sidebar recovered after restart. Tests are isolated from real Herdr. The v0.2.7 failed tag was not rewritten. Local install already has the runtime fixes, but retains the earlier version label. The paused and pending sections below are history, not current blockers.

## Shipped
- The user approved build, install, push, and release of accumulated prompt/runtime/UI work. v0.2.6 published successfully from 313e881; 571 offline tests/14 skips. CI successful, downloaded asset checksum and version verified. Private .agents notes/artifacts excluded.
- Follow-up spacing: compact all non-user structural boundaries; exactly one plain unhighlighted row around user messages (consecutive users share one). Internal Markdown/expanded tool content preserved. Commit 84339f9 pushed to develop, clean snapshot built/installed, 37 focused tests. User confirmed looks good.
- Pending Herdr job-status code (originally deliberately excluded from spacing-only install) subsequently verified and installed at user request. Reports working when agentActive OR taskActive; blocked takes precedence. Real shell-job integration regression covers 2->1->0 jobs, foreground activity, reload. Discovered notificationBatch was disposed forever after reload; added reset() and session_start call.
- Herdr compatible agent identity remains pi, not die. User noticed pi label; no identity change approved/implemented. Code/doc explanation references old 0.7.5, but live Herdr client/server now 0.9.0.

## Release currently PAUSED
- User requested push/release; package bumped to 0.2.7. Commit 6501742 pushed atomically with annotated v0.2.7 tag. Local checks all passed: 574 tests,14 skips,format/lint/typecheck/build/smoke/notices.
- GitHub release run 34776153408 FAILED before publication in tests/goals-sdk.test.ts: real SDK reconciles helper waiting through task-complete and completes; line274 expected statuses [waiting,active,completed], received [active,completed]. Likely short fixture job finishes before handoff but NOT investigated/fixed. Log /tmp/die-v027-release-failure.log. No retry, tag move, followup release, or new install authorized since user interrupted with sidebar disappearance.
- Current installed binary has Herdr changes but reports version0.2.6 (installed before version bump); SHA256 7b48286187b156fc1e33942a1ead345f3f185d9b9c8dd5ec16e2cdc5bad2b647.

## Latest user issue: Herdr sidebar entry disappeared
- Herdr pane current: pane w1E:p6, agent_status unknown, foreground die PID3444683. Root env has HERDR_ENV=1, real socket ~/.config/herdr/herdr.sock and matching pane ID, no child depth/type.
- Real server log ~/.config/herdr/herdr-server.log shows numerous herdr:die:release calls at18:55:05..58 coinciding local full release tests. tests/main-agent-mode-tui.test.ts inherits real HERDR env despite temp HOME/unique tmux socket. Suspected tests claim/release same real pane; don't repeat host-connected suite.
- The user was told that the investigation paused the release. Restarting Die should reclaim the entry. Do not manually report/release real pane or signal its processes.
- Read-only investigator task_ff9e8e14 finished: real Pi0.85 ctx.mode correctly equals tui; mode guard not missing. Local module authority cannot protect against different processes sharing pane identity; stale sequence/release possibilities need server evidence.
- Active worker task_525d1b16 owns test isolation fix (helpers/test fixtures/tui harness as needed) and fake-socket regression. It must keep intentional Herdr tests that use their own recording sockets. Run tests with HERDR_ENV=0 until isolation proven; no real Herdr mutation, paid experiments, install/commit/push. Await completion, review evidence.

## Next
1. Review test-isolation worker and verify fake endpoint cannot be reached by test-spawned CLI/TUI.
2. Check user sidebar recovery. No broad infrastructure or model experiments are needed.
3. Separately diagnose CI goal fixture failure offline before proposing release continuation. v0.2.7 tag exists but release unpublished; don't silently rewrite public tag.

## Test isolation completed, awaiting user recovery confirmation
- task_525d1b16 completed. New bunfig.toml loads tests/setup.ts to disable Herdr/remove host identity before tests load; tests/helpers.ts sanitizes child env even custom env; scripts/tui-harness.ts sanitizes tmux env and launch for reused servers; tests/offline-process-isolation.test.ts uses real offline TUI with local fake recording socket and verifies zero host-identity calls. No production runtime edits.
- Worker full suite under HERDR_ENV=0:575 pass,14 skip; typecheck/format passed, zero real Herdr log calls during validation. Parent reviewed and reran isolation+Herdr:12 pass,0 fail (task_a1aae6c7).
- These isolation changes are not committed or pushed. Release still paused; no retry/public tag move. Last question to user: Did restarting die restore the sidebar entry?

## Recovery and v0.2.8 underway
- The user confirmed that restart restored the sidebar, then approved the CI fix and release restart.
- Worker task_f7601e81 found fixture sleep0.1 could finish before handoff. tests/goals-sdk.test.ts now gates real job on file, releases after goal tool_execution_end listener persisted waiting, asserts handoff status waiting, retains full lifecycle assertion. 35 repeated focused passes, goals31pass/1skip. Production runtime unchanged.
- Parent full validation v0.2.8 passed575tests/14skips, format/lint/check/build/smoke/notices/tag-validation/diff. Log /tmp/die-v028-validation.log. All commands HERDR_ENV=0.
- Commit99464c6 includes version0.2.8, test isolation and gated goal test; tagged v0.2.8. Push task_4a72b83b in progress at note time. v0.2.7 tag left intact, unpublished. Next watch release workflow, verify published assets checksum/version. No additional local installation requested for v0.2.8.

## v0.2.8 publication complete
- Push succeeded; release workflow34777461220 succeeded. https://github.com/tnfssc/die/releases/tag/v0.2.8 is public non-draft/non-prerelease. Downloaded binary checksum verified and --version0.2.8; SOURCE.txt matches99464c60638427e4968b1ad1397849a7b6709c68, target bun-linux-x64-baseline. Verification jobtask_f202b00e completed.
- No live model experiments or new local install during this final release. Existing installed runtime already contains Herdr status fix from prior explicit install but version label0.2.6. v0.2.7 failed tag remains untouched. No jobs are still running.
