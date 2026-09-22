# Dependency update / next release (2026-09-22)

User asked update deps and new release; no installation requested. Current published v0.5.3. Proposed next patch v0.5.4, do not reuse existing tags. Current branch feat/native-task-workspaces HEAD 8d8f068 (publication notes), origin/develop cb3eca2. Many preexisting untracked wisdom/experiments/scripts and index edits: preserve, stage explicit task files only.

Main changed only package.json/bun.lock (four Pi packages 0.85.1 -> 0.87.0), and prepare-assets.ts version/hash guard. This guard bump is PROVISIONAL until adapter review passes. New hash d365ffb5a189915c3af93953daf751bff45fe46222b05c426f8d8b845946bebf. No source/test hacks landed; check has ~14 API errors due messages-only TranscriptContext + readonly agent systemPrompt. Important upstream session context/projection semantics need real adaptation, not casts.

Implementation delegated to orchestrator task_6de63bb9 in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6de63bb9 branch die/implement-pi-0.87-compatibility-6de63bb9, from HEAD. Own complete dependency/source/test upgrade including adapter parity, web integration compatibility review, checks/tests/build/notices. Must commit/report, no publish. Main integrate by replacing only its provisional package/lock/guard edits before cherry-pick. Research task_36ddf1df remains running in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_36ddf1df branch die/dependency-update-research-36ddf1df; do not integrate redundant research blindly.

Release research task_d4ac3c9d finished; prior details wisdom/releases/release-v052.md. Publish develop fast-forward, wait complete branch CI before tagging exact successful commit, then release workflow and official artifact checks. CI includes root format/lint/check/build/tests/smoke and pinned T3 backend/web/contracts/projection suites. Latest four Pi packages 0.87.0, other root deps already latest per bun outdated. No tag/push/version bump yet. Preserve current installed binary.

Research worker task_36ddf1df drifted into full implementation; stopped at 06:38Z to avoid duplicate work. Its uncommitted exploratory changes remain in research worktree (do not integrate automatically). Authoritative implementation remains task_6de63bb9.

Integrated worker 4eda0d9 as d5cce65. Preserved preexisting index edits in .agents/rollback/index-pre-v054.md and restored them afterward. Version bumped 0.5.4 (uncommitted); frozen install/check/notices passed in main. Full test/build + smoke task_7d1ec811 running (artifacts/v054/{tests,smoke}.log). Independent read-only correctness review task_c35525ae active. Worker validated 741/14/0 full suite, history soak, web server typecheck/RPC; no live paid tests. Await local validation + review, commit release version/own note only, push HEAD:develop fast-forward; branch CI before tag. No push yet.

Main local validation first hit unrelated workspace state: format scans preexisting untracked experiments/scripts, and default cached T3 has old patch. No source failure established. Rerun build/test/smoke with DIE_T3_SOURCE pointing to integration worker verified patched cache. Clean-worker format passed; CI will validate clean release tree.

Main full rebuilt tests passed 741/14/0. Smoke rerun task_b7a8c267 with correct explicit T3 env (initial smoke invocation omitted it and selected stale default cache). Preparing version commit and branch CI; independent review still pending, tag gated on review and CI.

Pushed release candidate 4f7092e2c80ca6c9e0abeef17a5a03f53ca49e5a to develop. CI 35697326160 running; watcher log artifacts/v054/ci.log. NO TAG yet; await CI + review task_c35525ae + smoke task_b7a8c267.

REVIEW BLOCKER task_c35525ae: fresh compaction misses Pi before_agent_start setActiveTools reconciliation, stale selectedTools can reset hook loadout. Release untagged/paused. Assigned regression+fix worker (fresh worktree). Need integrate, rerun validation, push corrected commit and wait its CI before tag.
Fix worker task_bcefdb2e: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_bcefdb2e branch die/fix-fresh-compaction-tool-reconciliation-bcefdb2e from 4f7092e.

Main standalone smoke passed task_b7a8c267 on initial candidate. Still await compaction review fix and corrected CI.

Initial candidate branch CI 35697326160 PASS all gates. Still no tag: must integrate tool reconciliation fix and get corrected commit CI green.

Accepted dc778e6 tool reconciliation fix: mirrors SDK explicit-vs-implicit selectedTools comparison; real AgentSession.compact + Anthropic wire regression fails unfixed and passes fixed. 26 focused +4 continuity tests and check/format pass. Cherry-picked/pushing corrected candidate; wait new CI before tagging.
Corrected release candidate 733b0a2fbb8dadfc43794b99cbed523c15b2ae6c pushed develop. CI35698060089 watcher artifacts/v054/ci-fixed.log. Tag v0.5.4 only after this CI succeeds.

Corrected CI35698060089 PASSED. Annotated v0.5.4 created at 733b0a2 and tag push initiated; wait Release workflow then official assets/checksums/version.
Release workflow35698768893 active, log artifacts/v054/release-ci.log.

Release workflow35698768893 PASSED; v0.5.4 published https://github.com/tnfssc/die/releases/tag/v0.5.4 . All four binaries+checksum pairs and licenses/source present, release notes updated. Download verification first timed out after 300s (144MiB/191MiB), retry task_c0c86d62 with 1200s timeout and --clobber. Pending checksum + PATH=/nonexistent version + SOURCE; do not claim verified yet. No install.

COMPLETE: official Linux x64 download verified SHA256 84dd10b9af8a34ab7fdbb1127f33bc738ce1f3644762cfa6889f674fa4a58eb6; checksum OK, isolated PATH=/nonexistent --version reports 0.5.4. SOURCE matches release commit733b0a2 and patch SHA4d73cc3cdc4ad8962358d61bd31d178d3e47b346819bb2562d0b0d590c85ec02. Release and branch CI passed. All four platforms/checksums listed; only Linux x64 executed locally. No installed binary changed. User preexisting index/untracked files preserved.
