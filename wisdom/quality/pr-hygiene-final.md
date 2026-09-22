# PR hygiene final: portable T3-v2 acceptance harness

## Result

The retained production acceptance harnesses now default to the canonical
revision-keyed checkout derived from `web/t3-source.json`. Migration defaults to
`web/t3.patch` and the canonical source manifest. Browser, native, preservation,
and worktree harnesses no longer default to `.cache/die-t3code-v2-production`.

Temporary state now uses `TMPDIR` through `os.tmpdir()` and private `mkdtemp`
directories. Child processes in migration/worktree acceptance receive private temp
directories. `packaged-smoke.ts` no longer imports the undeclared transitive `ws`
package; its Host/Origin upgrade probe uses `node:http` and `node:crypto`.

The README is self-contained and no longer gates execution on research wisdom or
candidate-only patches. The user-facing status doc links only to checked-in docs and
the portable harness README. Unsupported exact suite totals, historical binary/patch
hashes, generated artifact links, the false formatting-exclusion claim, and the
unqualified setup-without-trust claim were removed. It now describes the propagated
source approval boundary and limits historical/live evidence appropriately.

## Exact stage recommendation for this ownership area

Include these paths together:

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

Required coherent dependencies elsewhere in the production PR (not edited by this
hygiene task):

- `web/t3-source.json`
- `web/t3.patch`
- `tests/fixtures/t3-native-task-contract.json`
- `tests/t3-native-routing.test.ts`
- `scripts/web-source.ts` and its production consumers/tests

Explicitly exclude:

- `scripts/t3-v2-production/build-candidate.ts`
- `scripts/t3-v2-production/export-candidate.ts`
- `scripts/t3-v2-production/export-worktree.ts`
- `scripts/t3-v2-production/artifacts/**`
- `artifacts/**`, `.cache/**`, generated binaries, screenshots, browser profiles,
  raw logs, proof JSON, JSONL, and private runtime state
- `experiments/**`, `.agents/patches/**`, `.agents/rollback/**`, and bulk
  research wisdom
- `wisdom/index.md` unless its complete link expansion is deliberately
  reviewed and staged
- this internal report, `wisdom/quality/pr-hygiene-final.md`, unless maintainers
  explicitly want PR-process notes in the product PR

The three research-only build/export scripts were not deleted or rewritten. Their
local candidate paths are intentional evidence that they are outside the portable
acceptance set, not unresolved defaults in a recommended harness.

## Focused validation

Passed:

- Biome format on the seven retained TypeScript harnesses (one fix applied).
- Bun static bundles for all seven retained TypeScript harnesses.
- `bun scripts/t3-v2-production/contract-conformance.ts` against the canonical
  pinned checkout: all four tool contracts plus structured-workspace checks passed.
- Static portability scan: no old candidate checkout, research patch, literal
  `/var/tmp`, or `ws` import in retained harnesses.
- Fixture wiring check for the native contract fixture and both migration fixtures.
- Local Markdown-link existence check for the README/status doc.
- Focused Biome lint completed with exit 0; it reports 31 warnings and 82 infos from
  pre-existing style patterns in the acceptance files, with no lint errors.

Live browser/native/migration/preservation/worktree gates were not rerun because they
require reviewed binaries and prepared external checkout dependencies. No root CLI or
web source was edited, and no index, commit, install, or user-file deletion was
performed.
