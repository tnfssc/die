# Official T3 nightly upgrade (2026-09-22)

- Owner worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_bb27ba6d
- Branch: die/switch-bundled-t3-code-to-nightly-bb27ba6d
- Scope: update canonical source pin and rebase patch keeping production native integration. No release/tag/push (parent owns release).
- Read production requirements, production/final history and earlier v0.0.42 integration notes before changes. Historical non-adoption notes are not the current canonical implementation. Keep current patch and native root code.
- Discovered latest official nightly tag via upstream git tags and GitHub release API: v0.0.43-nightly.20260922.2083, commit 0141bc2bf5fcf52a563240a6bce4b58050496db5. Official prerelease published 2026-09-22T02:07:57Z at https://github.com/pingdotgg/t3code/releases/tag/v0.0.43-nightly.20260922.2083.
- In progress: clean checkout/apply assessment, upstream channel verification, rebase and tests.

## Blocker discovered before changing product code

The current pin is NOT the stable/nightly lineage: it is the orchestration-v2 integration base. The latest nightly lacks apps/server/src/orchestration-v2/, apps/server/src/provider/Drivers/PiDriver.ts, packages/contracts/src/orchestrationV2.ts, packages/contracts/src/orchestratorMcp.ts and other required sources. Applying the canonical patch to nightly fails (artifacts/nightly-apply-check.log). It cleanly applies, reverse-checks, and passes verifyWebSource at the current canonical pin.

- Common ancestor: dfbb11bdd7c3f1a5575cb55d3e3abb12be025727.
- Common ancestor to current v2 base: 585 commits, 1450 files, 312401 insertions /162686 deletions.
- Common ancestor to nightly: 67 commits, 265 files, 13159 insertions /2896 deletions.
- Direct nightly/current-base delta: 1622 files, 315169 insertions /175717 deletions. This is not a modest patch conflict or simple rename. Retaining v2 would transplant an upstream architecture rewrite into our patch.
- Official .github/workflows/release.yml distinguishes npm nightly vs preview, and explicitly prevents preview builds entering stable/nightly auto-update channels. Latest official preview observed: v0.0.43-preview.20260921.2045 (b488c57f3f9f1688e31c53daee99e29dd1d0baa2). Preview was NOT substituted for the requested nightly.

## Validation and decision

- bun install --frozen-lockfile: passed.
- bun test tests/web-source.test.ts: 1 pass /0 fail /5 assertions.
- Current canonical clean apply + reverse-check + verifyWebSource: passed.
- Official nightly apply: failed as expected with missing v2/native source and context conflicts. Not adopted.
- No new patched nightly exists. So no nightly build/typecheck/runtime pass is claimed. Building unpatched nightly or rerunning unchanged current binaries would not validate the requested migration.
- Product pin/patch do not change. Docs now explain channel incompatibility. Parent must decide between latest official preview keeping v2, waiting for v2 in nightly, or explicitly authorizing a much larger native migration. Do not release a claimed nightly upgrade from this result.

## Delegation

- Documentation worker worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_bb27ba6d-a86675007a5e-task_38a15b2e. Branch die/nightly-channel-and-docs-audit-38a15b2e. Stopped when incompatibility was discovered, before adopting any prospective nightly docs/tests.
- Independent read-only channel/blocker audit task_8a375c3b runs in owner workspace.

Independent read-only audit completed: confirms official nightly lacks v2/native Pi sources and recommends retaining current pin or explicitly choosing the larger non-nightly v2 transplant. No safe pin-and-small-rebase candidate found.
