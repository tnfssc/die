# v0.5.0 release

User explicitly authorized MAKE RELEASE after PR #1 merged. No local installation authorized or performed.

## Decision and source
- PR https://github.com/tnfssc/die/pull/1 confirmed MERGED into develop at 2026-09-21T15:59:28Z; merge commit 93b88579d16f6a5f146188aa4808d65c90259d94.
- Latest tag/package was v0.4.0. Native T3 orchestration/workspaces and retained model selection are new functionality, so next feature minor is v0.5.0, following v0.3.0/v0.4.0 conventions. Only package.json carries product version; release tag validator enforces exact match.
- Original checkout contains concurrent uncommitted notes/experiments. Preserved without reset/clean/stash. Isolated release worktree tracks fetched origin/develop.

## Exact preparation commands

date/status inspection: git status --short; git remote -v; gh pr view 1 --json state,mergedAt,mergeCommit,baseRefName,headRefName,url

Read .agents/notes/index.md, resource-fixes-release.md, release-v034.md, release-v030.md, package.json, workflows/ci.yml and workflows/release.yml, scripts/validate-release-tag.ts; inspect current tags and previous release commit.

git fetch origin --tags
git worktree add -b release/v0.5.0 /tmp/die-release-v050 origin/develop

Package version changed from 0.4.0 to 0.5.0. Validation delegated in isolated checkout; logs artifacts/pre-release. Publication remains pending validation. Established workflow: commit/push develop, signed annotated version tag, push tag; GitHub Release workflow validates/builds/publishes four target binaries plus checksums/licenses/source. No manual bypass.

## Validation completed before tag

Merged develop CI https://github.com/tnfssc/die/actions/runs/35622652282 SUCCESS at merge SHA. Private release worker logs: artifacts/pre-release/ (not staged).

Commands: bun install --frozen-lockfile; CI=true pnpm install --frozen-lockfile in private pinned T3 checkout using pnpm 11.10.0; bun run format:check; bun run lint; bun run check; CI=true bun run build; DIE_RUN_LLM_TESTS=0 bun test ./tests; CI=true bun run smoke. All final executions PASS. Bun 1.4.1; local Node 24.15.0, workflow Node 24.13.1. Backend, web and client tsc --noEmit and exact release workflow vp selections pass (67 backend, 128 cache, 38 terminal tests). Added native selection 211 pass, web model 158, contracts 26, client projection 9. Full root: 737 pass /14 skip /0 fail, 4689 assertions, 100 files. Official release workflow reruns its own gates before publication.

Initial failed attempts retained: copied private dependency setup had stale resolution; pnpm reconciliation then needed CI=true. Fresh private frozen install and affected reruns passed. No code fix or waived gate. Root checkout/cache preservation checks pass. Built dist/die --version 0.5.0, SHA256 1d24e972b30b0737a7e7b685564c48e93768eb1dbbe959cf4f077f1dd8d53a38. Smoke rebuilds independently.

Coordinator final: bun run generate:notices; bun run format:check; bun run lint; bun scripts/validate-release-tag.ts v0.5.0; git diff --check all exit 0 (existing lint warnings remain). Notes generation creates ignored dist output, no tracked license drift.

## Publication commands

From isolated worktree: git add package.json docs/release-v0.5.0.md .agents/notes/release-v050.md .agents/notes/index.md; git commit -m "Release v0.5.0: add native task workspaces"; git push origin HEAD:develop; git tag -a v0.5.0 -m "v0.5.0"; git push origin v0.5.0. Repository commit/tag signing remains enabled. Non-force pushes protect concurrent remote updates; immutable existing tags not touched. Release run/result and downloaded-asset verification recorded below after completion.
