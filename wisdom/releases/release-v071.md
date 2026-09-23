# v0.7.1 release preparation

## Ownership and release facts

User approved the macOS Live patch release. Parent owns integration, push, annotated tag, CI/release publication, and published-asset verification. This worktree does not push, tag, publish, download release binaries, or install locally.

- Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d287808a
- Branch: die/prepare-v0.7.1-macos-live-patch-release-d287808a
- Base: 8e7f8b3, which records successful native macOS and full Linux CI run 35887687980 for the macOS Live fix integrated at 307bd0d.
- On 2026-09-23, `git ls-remote` showed remote `develop` and `HEAD` at 307bd0d and no `v0.7.1` tag. `gh release view` showed published, non-draft, non-prerelease v0.7.0 as latest. Recheck immediately before publication.
- v0.7.1 is a patch release for the macOS compatibility fix. `package.json` is the only active product-version surface; frozen install must leave the lockfile unchanged.

## Validation

Validated on Linux with Bun 1.4.1. Logs are retained under the ignored `artifacts/release/` directory in this worktree.

- `bun install --frozen-lockfile`: passed (131 packages); no lockfile or tracked-file change.
- `bun scripts/validate-release-tag.ts v0.7.1`: passed. The compiled standalone reported `0.7.1`.
- `bun run format:check`, `bun run check`, and `bun run lint`: passed. Lint retained existing warning/information diagnostics and reported no errors.
- `bun run build`: passed using the existing pinned T3 source checkout. This rebuilt the web client/server, portable dependencies, embedded archive, and standalone Linux binary.
- Full offline `bun test ./tests` under an isolated temporary HOME, explicit environment, and `DIE_RUN_LLM_TESTS=0`: 795 pass, 15 skip, 0 fail, 4,943 assertions across 110 files. Optional paid Live/LLM tests and interactive acceptance tests skipped as designed.
- Standalone smoke copied `dist/die` outside the repository and ran it with `env -i`-equivalent `HOME=<temporary> PATH=/nonexistent`: `--version` was 0.7.1, help had the expected header, `.die` was created, and legacy `.pi` was not.
- `bun run smoke:live-onboarding` passed against the newly built binary with an isolated parent HOME: fake credential import only, no paid provider connection and no audio command.
- `git diff --check` and final release-surface/status checks passed. No microphone, physical audio device, real credential, paid API, downloaded release binary, or local install was used.

## Scope and limitations

Native macOS CI proved Homebrew SoX CoreAudio availability and deterministic Live behavior without opening audio devices or using a provider. Local release validation is on Linux and must use isolated HOME with no real secrets, microphone, or paid API. Physical macOS devices, TCC permission prompts, acoustic behavior, latency, and echo remain unverified. Linux behavior is intended to remain unchanged.

The release-verification preference was followed: do not download published binaries merely to repeat CI hash checks, and do not install locally. Values were reviewed; existing principles on real-path checks, truthful proof, simple changes, user-work safety, and clear handoff cover this release, so no forced values change is warranted.

## Parent next steps

After integrating the preparation and evidence commits, recheck the final diff, remote `develop`, latest release, and absence of `v0.7.1`. Push `develop`, confirm CI, create and push annotated tag `v0.7.1` at the integrated release commit, watch the Release workflow, replace generated notes with `wisdom/releases/release-v0.7.1.md`, and verify the published latest release and expected nonempty assets without downloading binaries solely for hash reassurance.
