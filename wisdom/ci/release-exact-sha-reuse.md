# Release verification reuse

## Scope and ownership

Optimization only; v0.9.0 has already been published at develop 5f83446 (task_d44fa40b). No action, dependency, or tool version updates: dependency task4ea502d3 owns those. Its workflow edits may overlap this PR and must retain both sets of intent.

Original integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_603c4a8f

Continuation worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_775d42b1

Original branch: die/optimize-ci-and-release-duration-in-sepa-603c4a8f

Continuation branch: die/finish-saved-ci-optimization-pr-775d42b1

Implementation worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_603c4a8f-a86675007a5e-task_7b9c128c

Implementation branch: die/implement-release-reuse-optimization-7b9c128c

## Decision

Measure the critical path, not just test count. Moving tests out of release does not by itself eliminate work or reduce the wait. CI and Release currently select different upstream tests; treating an ordinary CI success as equivalent release proof would drop coverage. Prefer reuse of fully verified release assets over a new test orchestrator or cache of “success”. Exact commit identity also binds source, lockfiles, workflow, pinned tools, and patches; no partial-key build cache is needed.

## Values review

Read values and CI/release wisdom before implementation. Keep actual built-artifact proof, say what measurements do and do not show, retain one clear source of verification, protect unrelated release/dependency work, and choose the smallest useful change. Existing values cover this lesson; no values edits needed.

## Baseline evidence (2026-09-24)

Fetched successful runs with `gh run list --workflow release.yml --status success` and `gh run view RUN_ID --json jobs`

Step durations are completedAt minus startedAt; wall durations include scheduling. These are old-workflow observations, not measurements of this change.

| Run | Wall | Relevant steps |
| --- | --- | --- |
| [CI develop c5b6101](https://github.com/tnfssc/die/actions/runs/35910725281) | 8m27s | build 205s, backend tests 43s, deterministic tests 91s, smoke 135s |
| [CI develop 39ebe0f](https://github.com/tnfssc/die/actions/runs/35909683066) | 8m52s | build 205s, smoke 136s |
| [Release v0.8.2](https://github.com/tnfssc/die/actions/runs/35956568739) | 12m25s | Linux job 626s: build 204s, tests 93s, smoke 134s, cross-builds 73s, backend validation 45s, asset upload 23s; actual Mac gate 36s; publish 29s |
| [Release v0.8.1](https://github.com/tnfssc/die/actions/runs/35914454067) | 12m57s | Linux job 629s: build 203s, smoke 130s; actual Mac gate 71s |
| [Release v0.8.0](https://github.com/tnfssc/die/actions/runs/35911787187) | 11m39s | Linux job 557s: build 189s, smoke 109s; actual Mac gate 55s |

The clearest local waste is smoke.sh rebuilding dist/die after the same job already built it. Reusing that binary retains the smoke assertions and exact job/checkout provenance. The observed smoke step is 109–136 seconds, an upper bound on savings; expect most of that to disappear because the build dominated, but the remaining smoke checks still take time. Measure actual savings on hosted runs. No cross-run cache is needed for this saving. Reuse of successful develop release assets additionally removes the repeated full tag build/test job; download/staging and retained native smoke still cost time. Do not sum runner time and wall latency, or claim new timings before hosted runs.

Smoke worker worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_603c4a8f-a86675007a5e-task_7ed7fcf0; branch: die/remove-same-job-smoke-rebuild-7ed7fcf0.

## Integration and tradeoff

Recovered three commits and the original uncommitted push/develop provenance corrections without changing the original worktree. `CI-REVIEW-DIRECTION.md` in the implementation worker worktree requested reasoning rather than moving tests; it is coordination only, not committed. The release workflow is push-triggered on develop and tags; no invented manual dispatch. Successful develop release runs stage assets with the prospective version tag in SOURCE.txt. Tag runs reuse only a same-repository, successful develop push release run at the identical 40-character commit SHA, with one nonempty unexpired asset artifact; downloaded binaries must pass recorded SHA-256 checks and source/tag metadata checks. API failure, expired/missing artifact or wrong provenance falls back to the full release gates. The tag still exercises the actual packaged Mac updater/helper and waits for it before publication.

Tradeoff: same-job smoke reuse is a small, local change; cross-run reuse adds a lookup, extra artifact transfer and job-condition complexity. It is worthwhile when a tag points to an already fully validated develop SHA, but gives no saving if the artifact expired or the release SHA differs. Expected tag latency improvement is avoiding most of the historical 9–10 minute Linux release job, **not** a measured new wall time; transfer/staging and Mac smoke remain. No hosted run of this branch yet. PR #4 owns action/tool upgrades; leave them out of this optimization.
