# Direct dependency registry audit (2026-09-24)

Queried the public npm registry latest endpoint for every root direct dependency and devDependency (HTTP 200 for all); these are registry results, not semver guesses:

| Direct package | Manifest / resolved lock | npm latest |
| --- | --- | --- |
| @earendil-works/pi-ai | 0.87.1 | 0.87.1 |
| @earendil-works/pi-coding-agent | 0.87.1 | 0.87.1 |
| @earendil-works/pi-server | 0.87.1 | 0.87.1 |
| @earendil-works/pi-tui | 0.87.1 | 0.87.1 |
| @google/genai | 2.24.0 | 2.24.0 |
| es-module-lexer | ^3.0.2 / 3.0.2 | 3.0.2 |
| resolve.exports | 2.0.3 | 2.0.3 |
| zod | 4.6.5 | 4.6.5 |
| @biomejs/biome | 2.5.14 | 2.5.14 |
| @types/bun | 1.4.2 | 1.4.2 |
| typescript | 7.0.2 | 7.0.2 |

Only root package.json and bun.lock are tracked owned manifests/locks; a filesystem walk excluding generated caches and node_modules found no other owned manifests. The lock workspace specifications and resolved direct entries match the manifest. No newer major or other latest direct version exists to inspect or defer today. No manifest or lock change is warranted.

Pi remains pinned at 0.87.1. src/live/credentials.ts imports private Pi dist/core/auth-storage.js; the session-manager adapter also depends on guarded SDK internals. A future Pi release needs source/contract review and focused tests before bumping. Native SDK/T3 web source is pinned separately; no vendored tree was regenerated. See pi-0.87-upgrade.md and pi-0.87.1-update.md.

Static registry and manifest/lock comparisons passed. Full tests/check/build could not run without installing dependencies: this worktree has no node_modules and shell has no bun executable (bun run check exited 127). No tools or packages were installed; no paid providers, devices, secrets, pushes, or vendored web regeneration were used. Values stayed unchanged: “Know what a change means” already covers this decision.

## Integration and deferred source upgrade

Integration worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_4ea502d3`; branch: `die/update-dependencies-and-ci-actions-in-se-4ea502d3`. Dependency worker: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_4ea502d3-a86675007a5e-task_604c5f2e`, branch `die/dependency-registry-audit-and-updates-604c5f2e`. CI worker: sibling suffix `-a86675007a5e-task_3ae322be`, branch `die/ci-and-tool-version-audit-3ae322be`.

Official GitHub API query on 2026-09-24 returned T3 latest release `v0.0.42` and default HEAD `9383f4ad71285b9f9a6a9b65f2f961ea2cf4308f`. Comparing the current `b488c57f3f9f1688e31c53daee99e29dd1d0baa2` source pin to that HEAD reports diverged (108 ahead, 606 behind). This is not a safe drop-in dependency bump: retain the native SDK/web source and patch contract; a rebase requires separate native orchestration/private SDK migration evidence and browser/backend validation. No tracked vendored tree or lockfile was regenerated. Node 26 and pnpm 12 are also deferred in the CI audit.

## Final integrated validation

Re-fetched and rebased onto remote develop `7db8b85721d103ebd770c43d4aaae35de1a9255c` before final validation; it had not advanced. No develop/tag push or publish occurred. Independent read-only action migration review found no blockers.

Used a worktree-local official Bun 1.4.2 zip, verified against GitHub release asset SHA-256 `36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913`; no global tool or die installation. Frozen-lock dependency materialization changed no tracked manifest/lock. Bun 1.4.2 validation: frozen install, typecheck, format, lint (existing diagnostics), notice generation, `bun scripts/build.ts --reuse-web` and deterministic tests passed (859 pass, 15 skip, zero fail). Logs: `artifacts/dependency-ci/final-*.log`. Standalone smoke assertions passed on the built binary with empty environment/PATH.

The local compile reused an isolated copy of existing web output whose SOURCE revision and patch SHA matched this branch (`672bf19d14f1ba9fe3d411855b1cb5d4795aaf80c886eb5307feea80935e5902`). Full `bun run smoke` attempted a fresh web build but stopped because pnpm is absent from local PATH; full fresh web build/backend validation and hosted action execution remain PR CI gates, not claimed locally. No tracked web tree regeneration occurred. First preliminary run on Bun 1.4.1 had two shell-output failures caused by mise's missing-1.4.2 warning after the pin changed; final 1.4.2 suite passed using process-only `MISE_TRUSTED_CONFIG_PATHS=$PWD/mise.toml` and `MISE_LOG_LEVEL=error`, without changing global trust or installing tools. Paid providers, devices, and release actions were not invoked. Values reviewed again and unchanged: existing safety, honest validation, and migration-evidence principles cover the findings.
