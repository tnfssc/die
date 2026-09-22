# Final reviewed T3 preview live acceptance

Date: 2026-09-22

## Immutable inputs

- Canonical patch: `web/t3.patch` SHA-256 `3d343a59f2ca7a176ec2e93fc68200dea9e4ffd5fbce367e48903e2f70bd2530`.
- Fresh private candidate copy: `.cache/t3-preview-final-live-candidate`, upstream HEAD `b488c57f3f9f1688e31c53daee99e29dd1d0baa2`, canonical patch applied. `verifyWebSource` passed.
- Owner build completion was observed in `artifacts/t3-preview-adoption/build-final.log`: `Built .../dist/die`.
- Exact copied package: `dist/die-final-reviewed`, SHA-256 `4cf4d17e1a52b2543ecbbbcea851c1adf17fd76bf2898ba8c0ae87888024dae0`. Every binary-driven harness was pinned to this digest; no package was modified between runs.
- Owner packed web archive SHA-256: `0594b13e92bd5c60b48ee117b7ca78b128ab79601405a158d6288bc36ef979c9`.

## Build coordination evidence

The first owner build attempt stopped in `pnpm` with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. This was not waived: the owner retried the build in the appropriate CI/noninteractive mode, and this worker waited for both the later `Built .../dist/die` line and the file before hashing or launching any package acceptance. The successful package digest is the one recorded above.

## Release-gate result

All commands ran with `TMPDIR=/var/tmp` against the private candidate and exact binary hash above.

- `bun scripts/t3-v2-production/native-acceptance.ts`: **PASS** (actual `NativeDieIntegration.production.test.ts`).
- `bun scripts/t3-v2-production/browser-acceptance.ts`: **PASS** (fresh state, same live server, live child route, one completion wake, browser stop and refresh persistence).
- `bun scripts/t3-v2-production/preservation-acceptance.ts`: **PASS**.
- `bun scripts/t3-v2-production/worktree-acceptance.ts`: **PASS**; state intentionally retained.
- `bun scripts/t3-v2-production/contract-conformance.ts`: **PASS** for launch/observe/cancel/list and structured workspace validation.

Exact local evidence is under `artifacts/t3-preview-final-live/` (logs, JSON proofs, browser screenshots, candidate status/head, package and patch digests). No product defect was found and no release gate was waived. Current-production migration remains outside this assignment; historical migration had already passed in the preliminary worker.

## Retained worktree evidence

Harness root: `/var/tmp/die-worktree-acceptance-W2LpsE`; fixture base OID: `c446e4c15a5898ac1b31324e1b505ccb64989664`. The proof records 14 retained worktrees and branches:

- `refs/heads/accept/setup-background` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/web/worktrees/repo/accept-setup-background`
- `refs/heads/accept/setup-fail` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/web/worktrees/repo/accept-setup-fail`
- `refs/heads/accept/setup-missing` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/web/worktrees/repo/accept-setup-missing`
- `refs/heads/accept/setup-slow` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/web/worktrees/repo/accept-setup-slow`
- `refs/heads/die/independent-work-230cfb1137888512` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/web/worktrees/repo/die-independent-work-230cfb1137888512`
- `refs/heads/die/independent-work-257c13f136a1b98a` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/web/worktrees/repo/die-independent-work-257c13f136a1b98a`
- `refs/heads/die/independent-work-763c1ceb9be5d416` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/web/worktrees/repo/die-independent-work-763c1ceb9be5d416`
- `refs/heads/die/independent-work-921f14fea3e42f3a` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/web/worktrees/repo/die-independent-work-921f14fea3e42f3a`
- `refs/heads/die/independent-work-aa0919fa5c4a931b` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/web/worktrees/repo/die-independent-work-aa0919fa5c4a931b`
- `refs/heads/die/independent-local-work-20a77713` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/worktrees/repo-38f3b2e5a39b-task_20a77713`
- `refs/heads/die/independent-local-work-524a659b` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/worktrees/repo-38f3b2e5a39b-task_524a659b`
- `refs/heads/die/independent-local-work-6358c58c` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/worktrees/repo-38f3b2e5a39b-task_6358c58c`
- `refs/heads/die/independent-local-work-cea9df52` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/worktrees/repo-38f3b2e5a39b-task_cea9df52`
- `refs/heads/die/independent-local-work-d88a3dab` → `/var/tmp/die-worktree-acceptance-W2LpsE/home/.die/worktrees/repo-38f3b2e5a39b-task_d88a3dab`
