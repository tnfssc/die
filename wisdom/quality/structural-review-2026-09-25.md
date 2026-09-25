# Repository structure review (2026-09-25)

## User request and scope

After v0.11.2, user said T3/v2 material is still scattered and asked why they must point out each case. They want a deep review and a structurally sound repository, not another narrow list. Main acknowledged prior audit was too shallow. Review the whole ownership/dependency map, then implement coherent changes with tests. Do not claim every file should share one folder. Keep active code, canonical integration inputs, research tools, generated outputs and historical proof distinct.

Started from `c07526161a046f9fc19377ad2afa0ef9608bba4a` on `develop` in `/home/tnfssc/Code/die`. v0.11.2 is published at `7e4147b`; do not move it. New request does not require another release yet. No product edits at review start.

## Coverage

Tracked inventory: 126 src files, 62 scripts, 153 tests, 55 experiments, 11 .agents files, 3 web files, 12 support files, 11 native files, 3 evidence files, 333 wisdom notes. Current typecheck includes src/scripts/tests only; tests run under tests/; Biome excludes experiments. Any source move must preserve discovery/build embedding/quality gates. Active imports and execution paths matter more than file-name similarity.

Read-only workers (will return findings before implementation):
- T3 full integration inventory: `task_9beec03b`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_9beec03b`, branch `die/map-all-t3-integration-ownership-9beec03b`. Covers runtime, patch/pin, harnesses, experiments, .agents patches/rollback and all actual callers.
- Whole runtime dependency structure: `task_4f5d7cb8`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_4f5d7cb8`, branch `die/review-whole-runtime-dependency-structur-4f5d7cb8`. Covers every runtime domain and dependency directions/cycles, not only T3.
- Tooling/source boundaries: `task_fbf1be8d`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_fbf1be8d`, branch `die/review-repository-tooling-and-source-bou-fbf1be8d`. Covers all non-runtime tracked roots, CI/build/test discovery, active source vs research/evidence.

## Next

Reconcile inventories and inspect evidence. Pick one clear layout before edits; explain decisions briefly but do not ask user to identify more examples. Assign disjoint implementation worktrees. Update all callers/discovery/config/doc entrypoints, add structural boundary checks where useful, review combined diff, and run full shared local gate with pinned tools. Keep behavior and security boundaries intact. No live/provider/device calls just for rearrangement.

Values read. Value 3 already says one owner and shared rules with real owner; broader review may reveal a repeated lesson to refine after evidence. No value edit yet.

## Decisions after full inventory

- T3 roles: host adapters/runtime in `src/t3/{tasks,web}`, canonical upstream/build/gates/fixtures in `integrations/t3/`, deterministic tests in `tests/t3/`, old pipelines/proofs in `experiments/t3/`. This is one named subsystem following the repo’s source/tool/test roles, not one mixed folder that promotes old candidate sources to production.
- Canonical inputs move together with byte-identical pin/patch/bootstrap; every active reader and source attestation follows. Preserve historical Git-object paths.
- Agent composition and context hooks move to `src/agent/`; task manager/service/worktrees/attention remain task owners. History gets a small persisted shake-record contract, not a command-module dependency.
- Rejected moving shared session code back to Live. The prior session-boundary work intentionally removed task-to-Live coupling and exposes provider-independent normalized input/operations. A voice wire discriminator is not proof that session authority belongs to Live.
- Keep root multi-consumer contracts, UI-to-domain reads, goal coordinator ports, provider-specific Live protocols and native test colocations. No runtime cross-domain cycle was found; type-only OpenAI edge does not count as a runtime cycle.
- Main adds `ARCHITECTURE.md`, updates contributor checks, and tests runtime/research, history/controller, session/provider and T3/task-authority boundaries.

Implementation workers (all based at c075261):
- `task_049a8681`: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_049a8681`, branch `die/consolidate-t3-runtime-and-tests-049a8681`.
- `task_0542e553`: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_0542e553`, branch `die/consolidate-t3-inputs-tooling-and-resear-0542e553`. Orchestrator may delegate disjoint tooling/archive edits.
- `task_7ce00e91`: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_7ce00e91`, branch `die/clarify-agent-composition-and-history-co-7ce00e91`.

Expected merge edges: T3 worker updates imports in the composition root while agent worker renames it; runtime worker relocates T3/web tests while tooling worker updates their canonical-input references. Parent must resolve both, not choose one side wholesale. Parent docs/boundary tests target the final layout and will fail until all workers land.

Pre-move canonical SHA256: patch `672bf19d14f1ba9fe3d411855b1cb5d4795aaf80c886eb5307feea80935e5902`; source JSON `ff731bae7b46dd54f582f9d2bb9c3ce288724513acc977559c6b6af51db43726`; bootstrap `154fc94a56be176ef6f4e6591f594a5834fd81bc2afe101442cc0b8d6364ebc2`. Verify identical after move. Existing pin is b488c57f3f9f1688e31c53daee99e29dd1d0baa2. Full validation should use a fresh dedicated upstream cache checkout via `DIE_T3_SOURCE`, not only existing dist archive reuse.

Runtime/T3 worker integrated as `14e095f` from `455f11b`. Its anticipated build filenames differ from final plan in two moved tests (`build-web.ts`/`web-source.ts` vs `build.ts`/`verify-source.ts`); fix when tooling lands. New architecture checks already catch the existing history-to-manual-shake dependency; other runtime/research and T3/task-owner checks pass. History violation should disappear when agent/history worker lands. The final existence/ownership check awaits all moves.

## Integrated layout

Agent/history worker integrated as `4e5cbcd` from `da44214`; resolved composition-root rename with the new T3 imports. Tooling tranches integrated as `d0de857`, `380b09f`, `e3f7ee4` from `e9e861b`, `3c8e202`, `b4692e0`. Resolved build/archive imports, gate fixture paths and moved test roots; no behavior conflict.

Parent found two extra T3 incremental patches whose names did not say T3. Their diff headers target upstream apps; archived byte-identically with other patches. Moved the general old index snapshot to `evidence/history/` with a provenance README. Preserved old ignored `experiments/t3-v2/.runtime/` browser/cache state in place and added a root ignore rule after moving its old .gitignore. Never stage or delete that private local state. Normalized tests/t3 filenames to avoid redundant t3 prefixes.

Canonical three input hashes match exactly after moves. Parent `bun run check` passed. All seven architecture/session boundary tests pass; history no longer imports the command controller. A broader focused run is pending in task `task_825a8395`, log `/tmp/die-structure-focused.log`. Final full gate must use fresh upstream checkout via DIE_T3_SOURCE. No new release requested for this post-v0.11.2 structural work.

Values: refined existing value 3 (no new value) to require whole-subsystem/callers/build/tests/research tracing before a structural cleanup. The earlier example-only audit was insufficient. This applies to broad structure work, not as ceremony for every small fix.

Focused combined verification passed: 94 tests across architecture/session, T3 and workflow/runner suites. Full gate first stopped on formatting in two moved acceptance scripts; fixed in `81ac023` without behavior changes. Full gate now task `task_bde5555a`, log `/tmp/die-structure-full-ci.log`, `DIE_T3_SOURCE=/home/tnfssc/Code/die/.cache/die-t3code-structure-fd424a7` (fresh source checkout). Pinned tools: Bun1.4.2, Node24.21.0, pnpm11.27.1.

Independent review of combined `c075261..fd424a7`: task `task_96a0e5f6`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_96a0e5f6`, branch `die/review-complete-structural-consolidation-96a0e5f6`. Only the subsequent formatting fix lies outside its source-review baseline. Await review and full gate before declaring done.

Independent review approved with no concrete blocker. Verified canonical patch/pin/bootstrap/shared fixture bytes unchanged; 86 exact-blob archival copies and 11 moved maintained gates/probes account for removed old paths. No stale active imports/build references found; only intentional historical Git lookup remains. Registration code, launcher and shake validation preserved. Discovery/config points to maintained locations; ignored old private runtime path remains ignored. Review did not execute build/live checks; full fresh-source gate remains necessary.

## Final local proof

Full shared gate passed at `81ac023` (task `task_bde5555a`, exit 0) using a newly initialized dedicated upstream checkout `.cache/die-t3code-structure-fd424a7`, not a reused archive. Root: 1062 passed, 17 existing opt-in skips, 0 failed across 143 files. Web: 260 backend + 158 model + 26 contracts + 9 projection passed. Frozen install, format/lint/typecheck, full production build, offline source/compiled transport and standalone smoke passed. Aggregate `/tmp/die-structure-full-ci.log`; per-step `artifacts/ci/`.

Built `dist/die-web/SOURCE.txt` names canonical `integrations/t3/upstream/die.patch`, upstream b488c57f3f9f1688e31c53daee99e29dd1d0baa2 and unchanged patch SHA256 672bf19d14f1ba9fe3d411855b1cb5d4795aaf80c886eb5307feea80935e5902. Full source verifier ran during build. Independent review approved the combined source changes; only two formatting fixes followed. No API/device/live acceptance claimed.

Implementation complete locally; not pushed or released. Next if requested: push develop and verify hosted CI/release dry run before any new release. v0.11.2 tag remains unchanged. Review guidance is now `ARCHITECTURE.md`; contributor checks use the shared CI command. Value 3 refined for whole-subsystem tracing; no new value. Historical/private local state preserved.
