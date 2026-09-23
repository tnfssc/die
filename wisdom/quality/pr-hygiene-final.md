# PR hygiene final: portable T3-v2 acceptance harness

## Result

The kept production acceptance harnesses now use the canonical revision-keyed checkout from `web/t3-source.json` by default. Migration defaults to `web/t3.patch` and the canonical source manifest. Browser, native, preservation, and worktree harnesses no longer default to `.cache/die-t3code-v2-production`.

Temporary data now follows `TMPDIR` through `os.tmpdir()` and uses private `mkdtemp` directories. Migration and worktree child processes get their own temp directories. `packaged-smoke.ts` no longer imports the undeclared transitive `ws` package. Its Host/Origin upgrade probe uses `node:http` and `node:crypto`.

The README now stands on its own. Running it no longer depends on research wisdom or candidate-only patches. The user status doc links only to checked-in docs and the portable harness README. It no longer makes unsupported claims about exact suite totals, old binary or patch hashes, generated artifact links, formatting exclusions, or setup without trust. It explains the source-approval boundary passed to child work and marks the limits of old and live evidence.

## Exact stage recommendation for this ownership area

Keep these paths together:

- `wisdom/t3/t3-v2-delegation-status.md`
- `scripts/t3-v2-production/README.md`
- `scripts/t3-v2-production/browser-acceptance.ts`
- `scripts/t3-v2-production/contract-conformance.ts`
- `scripts/t3-v2-production/migration-acceptance.ts`
- `scripts/t3-v2-production/migration-fixture-current.ts.txt`
- `scripts/t3-v2-production/migration-fixture-old.ts.txt`
- `scripts/t3-v2-production/native-acceptance.ts`
- `scripts/t3-v2-production/packaged-smoke.ts`
- `scripts/t3-v2-production/preservation-acceptance.ts`
- `scripts/t3-v2-production/worktree-acceptance.ts`

The production PR also needs these matching files from elsewhere. This hygiene task did not edit them:

- `web/t3-source.json`
- `web/t3.patch`
- `tests/fixtures/t3-native-task-contract.json`
- `tests/t3-native-routing.test.ts`
- `scripts/web-source.ts` and its production users and tests

Leave these out:

- `scripts/t3-v2-production/build-candidate.ts`
- `scripts/t3-v2-production/export-candidate.ts`
- `scripts/t3-v2-production/export-worktree.ts`
- `scripts/t3-v2-production/artifacts/**`
- `artifacts/**`, `.cache/**`, generated binaries, screenshots, browser profiles, raw logs, proof JSON, JSONL, and private runtime data
- `experiments/**`, `.agents/patches/**`, `.agents/rollback/**`, and bulk research wisdom
- `wisdom/index.md` unless its whole link expansion is reviewed and staged on purpose
- this internal report, `wisdom/quality/pr-hygiene-final.md`, unless maintainers want PR-process notes in the product PR

The three research-only build and export scripts were not deleted or changed. Their local candidate paths show that they sit outside the portable acceptance set. They are not missed defaults in a recommended harness.

## Focused validation

Passed:

- Biome format on the seven kept TypeScript harnesses. One format fix was needed.
- Bun static bundles for all seven kept TypeScript harnesses.
- `bun scripts/t3-v2-production/contract-conformance.ts` against the canonical pinned checkout. All four tool contracts and the structured-workspace checks passed.
- Static portability scan. The kept harnesses have no old candidate checkout, research patch, literal `/var/tmp`, or `ws` import.
- Fixture wiring checks for the native contract fixture and both migration fixtures.
- Local Markdown-link checks for the README and status doc.
- Focused Biome lint with exit 0. It reported 31 warnings and 82 infos from old style patterns in the acceptance files, with no lint errors.

Live browser, native, migration, preservation, and worktree gates did not run again. They need reviewed binaries and prepared external checkouts. No root CLI or web source changed. No index, commit, install, or user file was deleted.
