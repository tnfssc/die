# Native cost unavailable after v0.5.5

The user saw the UI label “Cost own unavailable · subtree unavailable” after preview release.
Do not assume zero cost or missing pricing without evidence.
Investigation task `task_7c3f51d5` uses /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c3f51d5, branch die/investigate-unavailable-native-cost-disp-7c3f51d5.
It must trace provider usage and pricing through persistence, snapshots, and UI.
It must compare the old and current patches and reproduce the issue with real event shapes.
No release/install authorized for this new report yet.
Do not mutate user DB or expose credentials.

Early result: the existing and new focused cost pipeline tests pass.
Available local state and logs predate the preview.
They show old cost-ingestion loss, not a proven preview regression.
We still need the affected thread context (new/existing, completed turn, provider/model, persistence after reload).
Worker adds regression guards; no runtime fix established yet.

The investigation finished.
All 99 focused tests and the server typecheck pass.
It changed only regression tests.
It found no runtime fix or confirmed preview regression.
Report retained in worker wisdom/t3/t3-preview-cost-unavailable-investigation.md, independent source .cache/t3-cost-source (source test commit 36cea885c).
More diagnosis needs the user’s answers; no release/install done.

## Clarification: empty project homepage
User confirms no conversation existed: cost unavailable label appeared immediately on opening die web in project homepage input corner.
This is empty-state UI noise, not a cost propagation failure.
Hide cost summary until recorded usage exists, keep honest unavailable for actual unpriced usage and explicit zero costs/subtree-only usage.
Delegated isolated UI fix; no release/install requested for this change.

UI fix task_88fa0448: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_88fa0448, branch die/hide-empty-homepage-cost-summary-88fa0448.
Parent must review/integrate after completion.
Prior e300825 tests-only investigation not integrated.

UI fix completed and reviewed; cherry-picked 578202a as 3591aa2 into develop.
Cost rendering now needs recorded own or subtree turns.
Four focused tests, web typecheck, format and exact-source verification pass; parent independently verified patched source identity.
No ingestion/runtime accounting changes, no release/install.
Details in t3-preview-hide-empty-cost-summary.md.
