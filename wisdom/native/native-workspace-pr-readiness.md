# Native task + workspace PR readiness

Audit snapshot: branch `feat/native-task-workspaces` at `05ff98f5907b` (same as `develop`).
Read-only audit except this wisdom file; implementation is still changing the worktree, so re-run the inventory before staging.

## Current blockers

- **CI paths are guaranteed stale.** `scripts/build-web.ts` now builds the default checkout at `.cache/die-t3code-<revision>`, but `.github/workflows/ci.yml` and three `.github/workflows/release.yml` steps still `cd .cache/die-t3code/...`.
  Update workflow paths from the pin (or expose one stable path) before PR.
  CI also runs only five selected upstream tests; add focused patched native orchestration/MCP/projection/completion tests so the canonical web changes regress in PR CI, not only release/manual harnesses.
- **Workspace tree changed during the audit and still needs a safety decision.** Wiring, `tests/worktree-workspace.test.ts`, and `scripts/t3-v2-production/worktree-acceptance.ts` appeared after the first inventory.
  Local launch now reads `t3.json` from the possibly dirty source checkout and automatically shell-executes the first `runOnWorktreeCreate` command, including untracked config, without the explicit approval called for by the research conclusion.
  Add/verify an approval boundary (or document an intentionally trusted-config policy) plus tests for denial, invalid refs/Git failures, setup failure/timeout, partial batches, and retained-worktree lifecycle.
  Re-inventory after implementation stops changing.
- **Production acceptance scripts still depend on review-only candidate state.** `build-candidate.ts`, `export-candidate.ts`, `migration-acceptance.ts`, and README commands/defaults point to `.agents/patches/*` and/or `.cache/die-t3code-v2-production`; those inputs shouldn't ship.
  Candidate patch is byte-identical to canonical `web/t3.patch`, so exclude the duplicate and retarget retained harnesses to `web/t3-source.json`, `web/t3.patch`, and the canonical hashed checkout. `contract-conformance.ts`, browser/native/preservation harness defaults also use the old candidate checkout.
- **Non-portable temporary paths in proposed shipped harnesses.** Browser and preservation use literal `/var/tmp`; migration needs it and forces it into children; native defaults to it.
  Use `TMPDIR`/`os.tmpdir()` with a private `mkdtemp` directory (allow an explicit override).
  The new worktree acceptance script and worktree unit fixture also hardcode `/var/tmp`; make tests portable with `os.tmpdir()`.
  Synthetic fixture strings may stay non-operative data.
  No shipped candidate source contains `/home/tnfssc`.
- **Docs aren't self-contained if research/evidence is excluded.** `wisdom/t3/t3-v2-delegation-status.md` links to untracked `wisdom/*` and ignored/generated `artifacts/*`; its claim that root formatting excludes experiments is now false. `scripts/t3-v2-production/README.md` also gates on a research wisdom file and documents candidate-only paths.
  Fix links/claims and canonical commands, or exclude both docs for this PR.
- **Reproducibility/dependency issue:** `packaged-smoke.ts` imports `ws` as an undeclared transitive root dependency.
  Replace it with a declared dependency (with lock/notices review) or a supported built-in/client already declared.
  No package/lock change now accompanies it.

## Hygiene and validation observations

- `bun run format:check` now fails only on 21 files under `experiments/t3-v2/`; all other scanned files formatted.
  Do not change project `.gitignore`/Biome merely to conceal these.
  Keep experiments outside the PR and run explicit production-path formatting while the local research tree is still, then verify root formatting in a clean checkout. `bun run lint` exits 0 but reports warnings, including new production files; review new-file warnings instead of treating exit 0 as clean.
- Canonical pin is `web/t3-source.json` at revision `a9b49a7d…`.
  Canonical `web/t3.patch` SHA-256 matches the candidate duplicate, and `verifyWebSource` accepted the existing pinned candidate checkout as exactly HEAD + canonical patch (disposable index; no build).
  The patch changes contracts/provider/orchestration/UI/client code and tests, but no package manifest, lockfile, license, notice, or new migration file. `scripts/build-web.ts` copies upstream `LICENSE` into the package; still run notice generation and inspect the generated attribution diff because the upstream revision changed.
- Required fixture `tests/fixtures/t3-native-task-contract.json` is consumed by both `tests/t3-native-routing.test.ts` and `scripts/t3-v2-production/contract-conformance.ts`; stage it with those consumers.
- Heuristic secret scan found auth-shaped literals only in candidate/rollback patches and test/acceptance files.
  Treat those as paths requiring manual placeholder review; don't stage experiment proofs, screenshots, JSONL/raw logs, browser profiles, caches, or rollback material.
  No secret value is recorded here.

## Recommended staging scope (after blockers are fixed)

Stage production source and deterministic tests as one coherent set:

- tracked Die changes under `src/`, `src/prompts/execute.md`, `scripts/build-web.ts`, plus new `scripts/web-source.ts` and completed workspace source;
- `tests/herdr-agent-state.test.ts`, `tests/job-bridge.test.ts`, `tests/subagent-extension.test.ts`, new `tests/t3-*.test.ts`, `tests/web-source.test.ts`, the native contract fixture, and new workspace tests;
- canonical `web/t3-source.json` + `web/t3.patch` only;
- fixed CI workflow coverage;
- only acceptance scripts/fixtures that have canonical, portable defaults and documented prerequisites; likely exclude `build-candidate.ts` and `export-candidate.ts` entirely;
- this concise readiness note (and a corrected self-contained user-facing status doc only if desired).

Explicitly exclude `experiments/`, `.agents/patches/`, `.agents/rollback/`, bulk research wisdom, ignored `wisdom/`, `artifacts/`, `.cache/`, runtime/browser profiles, screenshots, raw proof/log/JSONL files, generated binaries, and duplicate candidate patches.
Do not stage `wisdom/index.md` unless every newly linked note is intentionally reviewed and staged; otherwise revert that index delta for this PR.

## Final validation commands

`git status --short --untracked-files=all`

`git diff --check && git diff --cached --check`

`bunx biome format <exact-staged-ts-js-json-paths>`

`bunx biome lint <exact-staged-ts-js-paths>`

`bun run generate:notices && git diff --exit-code -- THIRD_PARTY_NOTICES.md third_party`

`bun run check && bun test ./tests && bun run build && bun run smoke`

Run the corrected contract/native/migration/browser/preservation harness commands from their README with fresh private temp/state and explicit reviewed binary/hash.
Then validate the upstream patched test list used by CI, and finally repeat `bun run format:check && bun run lint` in a clean checkout containing exactly the staged tree.
