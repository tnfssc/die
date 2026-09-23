# Preview current-production migration acceptance (2026-09-22)

## Owned persistent sources

- Worktree/branch: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_4ac90928`, `die/preview-current-production-migration-acc-4ac90928`.
- Current production clone: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_4ac90928/.cache/migration-sources/current-production`, detached at `a9b49a7df0a4261dcc438d4493cc3154a1d9819e` plus canonical `web/t3.patch` from integration commit `c6fe280` (SHA-256 `4d73cc3cdc4ad8962358d61bd31d178d3e47b346819bb2562d0b0d590c85ec02`).
- Preview clone: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_4ac90928/.cache/migration-sources/preview`, detached at `b488c57f3f9f1688e31c53daee99e29dd1d0baa2` plus the adopted canonical `web/t3.patch`.
- Dependency store/cache: worktree-owned `.cache/migration-pnpm-store`, `.cache/migration-cache`, and `.cache/migration-corepack`; no shared package cache was mutated. Both source installs used `--frozen-lockfile --ignore-scripts` after source patches were applied.

These clones and caches are intentionally persistent, ignored review inputs. The retained harness does not install and accepts explicit checkout/patch paths.

## Acceptance result

`TMPDIR=/var/tmp T3_V2_MIGRATION_PRODUCTION=.../current-production T3_V2_MIGRATION_PREVIEW=.../preview bun scripts/t3-v2-production/migration-acceptance.ts`: PASS.

The source gate checks each detached HEAD, reconstructs and hash-checks the pre-adoption production patch, verifies each complete tracked worktree equals HEAD plus its canonical patch, and verifies installed dependency lockfiles. Current production created 13 native V2 application events and their projections at migration 54. Preview opened the same database/settings in place, then a fresh preview process opened it again. Both preview passes proved:

- thread/run/two-node native graph and application event count;
- one complete normalized usage record: 321 input, 123 cached input, 17 cache creation, 45 output, 9 reasoning tokens, USD 0.42;
- provider session, thread, turn, stable native references, provider instance/model;
- completed native subagent job with acknowledged delivery;
- encoded settings through the preview `ServerSettings` schema, including runtime mode, provider instance config, and model price override, with byte hash preserved;
- user/assistant message history and visible turn-item order;
- identical semantic snapshot after preview restart.

Both revisions now end at database migration 54 and have identical persistence migration sources. This is current-production-to-preview in-place startup/restart compatibility and preservation evidence, not a claim that a new numbered schema migration ran. No migration blocker remains. Packaging and browser acceptance are outside this task.
