# T3 preview: hide empty native cost summary

## Change

Updated the canonical `web/t3.patch` with a minimal presentation guard. The composer now renders the native cost summary only when the report contains at least one recorded own or subtree provider turn (`own.turns > 0 || subtree.turns > 0`). No ingestion, pricing, contract, projection, persistence, or release behavior changed.

This keeps the existing formatter and semantics after activity exists:

- an empty/new homepage report is hidden instead of showing `Cost own unavailable · subtree unavailable`;
- a recorded turn with an explicit zero price remains visible as zero;
- a recorded turn without a price remains visible as `unavailable`;
- subtree-only recorded activity remains visible.

Focused logic coverage was added in:

- `apps/web/src/components/chat/nativeUsageCost.logic.test.ts`
- `apps/web/src/components/chat/nativeUsageCost.logic.ts`

The render guard is used by `apps/web/src/components/chat/ChatComposer.tsx`. It derives visibility from existing aggregate turn counts and introduces no new state.

## Source and worktree paths

- Wrapper worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_88fa0448`
- Independent source clone: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_88fa0448/.cache/t3-preview-cost-ui`
- Exact-apply verification clone: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_88fa0448/.cache/t3-preview-cost-ui-verify`
- Read-only reviewed source used only as the local clone origin/reference: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83/.cache/t3-preview-final-source`
- T3 base commit: `b488c57f3f9f1688e31c53daee99e29dd1d0baa2`

The independent source clone was created from the reviewed source repository at the base commit, then the starting canonical `web/t3.patch` was applied before editing. Dependencies were installed offline into the independent clone.

## Validation

Using Node 24.15.0 and the independent source clone:

- Focused unit test from `apps/web`: `../../node_modules/.bin/vp test run --project unit src/components/chat/nativeUsageCost.logic.test.ts` — **4 passed**.
- Web typecheck from `apps/web`: `../../node_modules/.bin/tsc --noEmit` — **passed** (existing Effect suggestions only).
- Format check: `node_modules/.bin/vp fmt --check apps/web/src/components/chat/ChatComposer.tsx apps/web/src/components/chat/nativeUsageCost.logic.ts apps/web/src/components/chat/nativeUsageCost.logic.test.ts` — **passed**.
- Candidate staged diff check: `git diff --cached --check` — **passed**.
- Exact apply: a clean independent clone at `b488c57` accepted `git apply --check --binary web/t3.patch` and `git apply --cached --binary web/t3.patch` — **passed**.
- Exact tree comparison: candidate and verification indexes both produced tree `250da128a332443ccc2ae3908f0fc009dd08cdcc`.
- Updated patch SHA-256: `672bf19d14f1ba9fe3d411855b1cb5d4795aaf80c886eb5307feea80935e5902`.

No release, tag, push, install of die, paid-provider call, or ingestion/pricing change was performed.
