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

## Final reviewed candidate and package

Semantic/resource review commit 52a3882 scopes native usage snapshot reads to the requested subagent subtree instead of decoding global persisted state. See t3-preview-adoption-semantic-resource-review.md for conflict review and 292 focused passing tests. Final patch SHA256: 3d343a59f2ca7a176ec2e93fc68200dea9e4ffd5fbce367e48903e2f70bd2530. Owner fresh clone updated and exact verification passed.

Actual final build-web/deploy/archive and executable build PASS (artifacts/t3-preview-adoption/build-final.log). The copied pnpm dependency tree initially triggered non-TTY purge confirmation due to a changed store path; retry used CI=true and an independently copied pnpm store, with no source/build checks bypassed. Final source: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83/.cache/t3-preview-final-source (independent copied clone, branch die-preview-probe); dependency store .cache/t3-preview-pnpm-store. This is the preferred fully prepared review candidate.

- Executable: dist/die, SHA256 4cf4d17e1a52b2543ecbbbcea851c1adf17fd76bf2898ba8c0ae87888024dae0.
- Archive: dist/die-web.archive.gz, SHA256 0594b13e92bd5c60b48ee117b7ca78b128ab79601405a158d6288bc36ef979c9.
- Manifest: dist/t3-preview-final-build.json; SOURCE.txt embeds final pin/patch identity. Server typecheck and portable ffi-rs dependency verification ran as part of actual build-web, not a substituted workspace build.
- Initial patch package security/preservation evidence is in t3-preview-packaging-security.md and explicitly superseded for final artifact claims; final hash-pinned checks are running.

Additional persistent workers:
- Current-production migration: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_4ac90928; branch die/preview-current-production-migration-acc-4ac90928.
- Final packaged native/browser/worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_1353128e; branch die/final-preview-packaged-live-acceptance-1353128e.

## Final owner checks

- `TMPDIR=/var/tmp bun test ./tests`: **743 pass, 14 expected skips, 0 fail, 4745 assertions across 101 files**, 94 seconds. Exact final package existed at dist/die; earlier invalid pre-build run is superseded. Log tests-final.log.
- `TMPDIR=/var/tmp bun run check`: PASS. `bunx biome format src scripts tests`: PASS (218 files). `git diff --check`: PASS. Logs check-final.log, format-final.log, diff-check.log.
- Exact final executable SHA-pinned `packaged-smoke.ts`: PASS. Evidence artifacts/t3-preview-adoption/packaged-smoke.{json,log}. Covers relocated path with spaces, unusable runtime PATH, exact owned-PID shutdown, preserved nested settings/provider metadata, HTTP and WS no-auth hostile Origin/Host matrix.
- Actual deployed LICENSE-T3CODE and valid JSON dist/client/third-party-licenses.json exist. Portable optional dependency verification ran successfully inside build-web; cross-platform execution is not claimed.
