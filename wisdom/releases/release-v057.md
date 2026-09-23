# v0.5.7 wisdom release

The user asked for a release after pushing commit 621bb51. The release contains project wisdom rename/reframe, root wisdom organization, old memory consolidation removal, docs/notes relocation. The version before release is 0.5.6. Preparing 0.5.7 with release notes in wisdom/releases/release-v0.5.7.md. The user does not want published binaries downloaded only to check their hashes. Trust release CI and asset publication unless there is a real risk.

## Local validation

Passed before release commit/tag:
- `bun run format:check && bun run check`
- focused wisdom/prompt/main SDK tests: 22 pass, 0 fail
- `bun scripts/validate-release-tag.ts v0.5.7`
- `bun run build`
- `bun test ./tests`: 719 pass, 14 skip, 0 fail, 4615 assertions
- `bun run lint` exited 0 with existing warnings/infos

The user did not ask for a local install.

## Published

Release workflow https://github.com/tnfssc/die/actions/runs/35743710810 and CI https://github.com/tnfssc/die/actions/runs/35743706424 both SUCCESS. Published https://github.com/tnfssc/die/releases/tag/v0.5.7 at 2026-09-22T15:03:08Z; draft=false, prerelease=false. Confirmed expected assets present from release metadata and set release notes from wisdom/releases/release-v0.5.7.md. As requested, there was no binary download or local install.
