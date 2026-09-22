# Official preview adoption and acceptance (2026-09-22)

User authorized adoption of official preview v0.0.43-preview.20260921.2045, commit b488c57f3f9f1688e31c53daee99e29dd1d0baa2. This task does not publish, push, tag, or version; parent owns release decision.

## Persistent workspaces

- Owner: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83; branch die/adopt-t3-preview-and-validate-release-re-49d9fc83.
- task_e57389e4: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_e57389e4; branch die/preview-packaging-and-relocated-security-e57389e4.
- task_a4ea7972: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_a4ea7972; branch die/preview-live-lifecycle-browser-migration-a4ea7972.
- task_b0b5ca20: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_b0b5ca20; branch die/preview-semantic-and-resource-acceptance-b0b5ca20.
- Original investigated source (read-only): /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8a2c4ca2-a86675007a5e-task_02d7b006/.cache/t3-preview-candidate, branch die-preview-probe.
- Owner review candidate: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83/.cache/die-t3code-b488c57f3f9f1688e31c53daee99e29dd1d0baa2, detached at pinned revision, independent clone (--no-hardlinks).

## Implementation

Initial adoption commit 51f8f7d imports investigated candidate patch SHA256 1c879cb723de12b3803b11c1772b9688267f65ee52d855f20fd7f658fcf9f4a0 and updates pin. README explicitly distinguishes official preview from nightly. Independent semantic review and runtime gates are pending; initial commit is not a readiness claim. Read absolute parent t3-preview-compatibility.md and t3-nightly-release.md; historical production-final non-adoption records are not current pin authority.

## Owner validation so far

- Fresh independent clone, clean git apply of canonical patch: PASS. scripts/web-source.ts verifyWebSource on that clone: PASS.
- bun install --frozen-lockfile and bun run check: PASS (artifacts/t3-preview-adoption/install.log and check.log).
- Initial bun test ./tests invocation was invalid: dist/die was not built, causing ENOENT failures. Stopped; will rerun against real package. No passing-suite claim. /tmp is nearly full; use TMPDIR=/var/tmp for further acceptance.
- git diff --check: PASS.

Live native/browser, current-production migration/restart, semantic/resource, actual build-web deploy/archive and relocated security gates are in progress in the workers above. No material gate is waived.
