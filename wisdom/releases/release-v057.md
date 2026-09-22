# v0.5.7 wisdom release

User requested release after pushing commit 621bb51. Release scope: project wisdom rename/reframe, root wisdom organization, old memory consolidation removal, docs/notes relocation. Current version before release 0.5.6; preparing 0.5.7 with release notes in wisdom/releases/release-v0.5.7.md. User preference: do not download published binaries just for checksum verification; rely on release CI and asset publication unless concrete risk appears.

## Local validation

Passed before release commit/tag:
- `bun run format:check && bun run check`
- focused wisdom/prompt/main SDK tests: 22 pass, 0 fail
- `bun scripts/validate-release-tag.ts v0.5.7`
- `bun run build`
- `bun test ./tests`: 719 pass, 14 skip, 0 fail, 4615 assertions
- `bun run lint` exited 0 with existing warnings/infos

No local install requested.
