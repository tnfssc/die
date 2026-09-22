# Native workspace CI fix

## Scope / coordination

This change is intentionally limited to `.github/workflows/ci.yml` and `.github/workflows/release.yml`. Feature, backend, build, harness, and test implementation remain owned by `task_b210d06d`; do not overlap these workflow edits. No release was dispatched.

## Diff

- Both workflows derive `DIE_T3_SOURCE` from `web/t3-source.json` after Bun setup and export the absolute revision-keyed checkout through `GITHUB_ENV`. Every stale fixed `.cache/die-t3code/...` workflow reference now uses that path, matching `scripts/build-web.ts`.
- Corrected the retained provider test from the removed `PiAdapter.test.ts` path to the adopted `PiProvider.test.ts` path.
- PR CI keeps the existing checks and adds a bounded candidate set under each package's own working directory/config:
  - server: native task/MCP, native integration, projection, continuation, local notification, native usage, Pi v2, and resource telemetry;
  - contracts: browser profile, orchestrator MCP, and provider runtime;
  - client runtime: orchestration v2 projection.
- Release coverage was not broadened; only checkout-path correctness and the removed Pi test path were fixed. Existing matrix/runtime setup, Bun 1.4.1 single-binary installation, and environment gates are unchanged.

## Static validation

- Parsed both workflow files with the installed `yaml` Node package.
- Extracted every workflow `run` block and checked it with `bash -n`.
- `git diff --check -- .github/workflows/ci.yml .github/workflows/release.yml` passed.
- Confirmed all 25 test paths referenced by CI/release exist in the revision-keyed adopted checkout for `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`, along with package-local runners/configs.
- Confirmed no fixed `.cache/die-t3code/...` reference remains in either workflow.

Per instruction, no build, test suite, network/provider operation, CI dispatch, release, commit, or push was performed.

## Caveats / orchestrator follow-up

- `NativeDieIntegration.production.test.ts` expects the local `dist/die` produced by the preceding existing CI Build step; its test fixture is local and does not require provider credentials.
- The main agent should run the requested clean-checkout validation before opening the PR.
- `task_b210d06d` is still changing workspace/worktree behavior and tests. Once that work stabilizes, the orchestrator should review any newly adopted focused worktree tests and add only stable package-local cases to PR CI (rather than a broad workspace/root upstream test command). Root `bun test ./tests` already remains in CI for Die-side deterministic worktree tests.
