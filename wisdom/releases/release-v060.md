# v0.6.0 release failure

Release run [35834533252](https://github.com/tnfssc/die/actions/runs/35834533252) failed on 2026-09-23 at `Validate tag matches package version`. The log says: `release tag "v0.6.0" does not match package.json version; expected v0.5.8`. It stopped before dependency install, build, and publication. This is a version mismatch, not evidence of a build failure.

The user asked for a diagnosis. No code, remote tag, or release was changed. To release 0.6.0, prepare and check a version-bump commit, then point the release tag at that commit. Rerunning the same tag will fail again. Replacing the remote tag still needs to be part of the agreed repair.

Values stayed the same. This is a local release detail covered by checking the real path and leaving clear proof.

## Repair underway

User approved the fix and release. Worker `task_6539b286` prepares the bump, notes, and local checks in `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_6539b286`, branch `die/prepare-v0.6.0-release-fix-6539b286`, based on `10d3161`. Parent owns cherry-pick, push, tag replacement, and publication checks. Do not download release binaries just to recheck hashes.

An empty published release also exists (created 2026-09-23T07:56:17Z, published 07:58:32Z). It has no assets. Remove this empty release before the fixed workflow reaches `gh release create`; keep the tag until the checked replacement is ready. Its notes list PR #2 (project values and task-end wisdom review), PR #3 (plain project prose), and https://github.com/tnfssc/die/compare/v0.5.8...v0.6.0.

## Local checks passed

Worker commit `e34b1cf` integrated as `06eb35a`. Frozen install, format, typecheck, lint, build, tag validation, and full tests passed (723 pass, 14 skip, 0 fail; 4,639 assertions). Lint has existing informational diagnostics. Lockfile needed no change. Parent checked the diff and reran tag validation. Next: push develop, remove the empty release, replace only the old `v0.6.0` tag using an exact lease against `10d31610d6e5c1ac7d4005ee7798cff15379e9de`, then watch CI and release and check asset metadata.

Pushed `develop` at `33698a4dad9fd82ab24200e243e21dabfaeb6858`. Removed the empty release and replaced the tag with an annotated tag at that commit using the exact lease. New Release run `35835705417` and CI run `35835677019` are underway. Watch logs: `/tmp/die-v060-release-watch.log` and `/tmp/die-v060-ci-watch.log`. Still need successful publication, notes, and asset metadata checks.

The prior develop CI run `35834340691` had a separate failure: the known job-attention heap-growth test measured 28,992,151 bytes against a 20 MiB limit at `tests/job-attention.test.ts:211`. This also flaked during v0.5.8 local checks. The repair full suite passed locally. Do not confuse that prior CI failure with the release tag mismatch. Watch the new runs before deciding whether more repair is needed.

Fresh CI `35835677019` passed. The release watch is still running.

## Published

Release run `35835705417` and CI `35835677019` passed. [v0.6.0](https://github.com/tnfssc/die/releases/tag/v0.6.0) published at 2026-09-23T08:21:31Z, not draft or prerelease, and is marked Latest. Notes set from `release-v0.6.0.md`. Verified all 12 assets are uploaded and nonempty: Linux x64/arm64, macOS arm64, Android arm64 binaries and checksums, plus license, third-party notices/licenses, and source metadata. The release detail endpoint briefly returned an empty asset list after the note edit; the dedicated `/releases/394439579/assets` endpoint confirmed all 12. No binary downloaded or installed.

No release work remains. The older heap-test flake remains a known test concern; fresh local and CI checks passed without changing or weakening it. Values stayed the same: the repair follows existing real-path checks and clear handoff guidance.
