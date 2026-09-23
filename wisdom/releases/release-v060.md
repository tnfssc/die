# v0.6.0 release failure

Release run [35834533252](https://github.com/tnfssc/die/actions/runs/35834533252) failed on 2026-09-23 at `Validate tag matches package version`. The log says: `release tag "v0.6.0" does not match package.json version; expected v0.5.8`. It stopped before dependency install, build, and publication. This is a version mismatch, not evidence of a build failure.

The user asked for a diagnosis. No code, remote tag, or release was changed. To release 0.6.0, prepare and check a version-bump commit, then point the release tag at that commit. Rerunning the same tag will fail again. Replacing the remote tag still needs to be part of the agreed repair.

Values stayed the same. This is a local release detail covered by checking the real path and leaving clear proof.

## Repair underway

User approved the fix and release. Worker `task_6539b286` prepares the bump, notes, and local checks in `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_6539b286`, branch `die/prepare-v0.6.0-release-fix-6539b286`, based on `10d3161`. Parent owns cherry-pick, push, tag replacement, and publication checks. Do not download release binaries just to recheck hashes.

An empty published release also exists (created 2026-09-23T07:56:17Z, published 07:58:32Z). It has no assets. Remove this empty release before the fixed workflow reaches `gh release create`; keep the tag until the checked replacement is ready. Its notes list PR #2 (project values and task-end wisdom review), PR #3 (plain project prose), and https://github.com/tnfssc/die/compare/v0.5.8...v0.6.0.

## Local checks passed

Worker commit `e34b1cf` integrated as `06eb35a`. Frozen install, format, typecheck, lint, build, tag validation, and full tests passed (723 pass, 14 skip, 0 fail; 4,639 assertions). Lint has existing informational diagnostics. Lockfile needed no change. Parent checked the diff and reran tag validation. Next: push develop, remove the empty release, replace only the old `v0.6.0` tag using an exact lease against `10d31610d6e5c1ac7d4005ee7798cff15379e9de`, then watch CI and release and check asset metadata.
