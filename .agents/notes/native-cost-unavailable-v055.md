# Native cost unavailable after v0.5.5

User reports UI “Cost own unavailable · subtree unavailable” after preview release. Do not assume zero cost or missing pricing without evidence. Investigation/fix task_7c3f51d5 in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c3f51d5, branch die/investigate-unavailable-native-cost-disp-7c3f51d5. Trace provider usage/pricing through persistence and snapshot/UI; compare old/current patch, reproduce with real event shapes. No release/install authorized for this new report yet. Do not mutate user DB or expose credentials.

Preliminary result: existing/focused new cost pipeline tests pass; local available state/logs predate preview and show historical cost ingestion loss, not established preview regression. Need affected current thread context (new/existing, completed turn, provider/model, persistence after reload). Worker adds regression guards; no runtime fix established yet.

Investigation task completed. 99 focused tests and server typecheck pass; only regression-test changes, no runtime fix or confirmed preview regression. Report retained in worker .agents/notes/t3-preview-cost-unavailable-investigation.md, independent source .cache/t3-cost-source (source test commit 36cea885c). Await user answers before further diagnosis; no release/install done.

## Clarification: empty project homepage
User confirms no conversation existed: cost unavailable label appeared immediately on opening die web in project homepage input corner. This is empty-state UI noise, not cost propagation failure. Implement hiding cost summary until recorded usage exists, preserve honest unavailable for actual unpriced usage and explicit zero costs/subtree-only usage. Delegated isolated UI fix; no release/install requested for this change.

UI fix task_88fa0448: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_88fa0448, branch die/hide-empty-homepage-cost-summary-88fa0448. Parent must review/integrate after completion. Prior e300825 tests-only investigation not integrated.

UI fix completed and reviewed; cherry-picked 578202a as 3591aa2 into develop. Cost rendering now requires recorded own or subtree turns. Four focused tests, web typecheck, format and exact-source verification pass; parent independently verified patched source identity. No ingestion/runtime accounting changes, no release/install. Details in t3-preview-hide-empty-cost-summary.md.
