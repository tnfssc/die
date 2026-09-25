# v0.11.2 code placement cleanup

Published: https://github.com/tnfssc/die/releases/tag/v0.11.2

User asked to finish the audited file/code moves, push, and release. Main integration workspace was /home/tnfssc/Code/die, branch develop. Started at 008fdf4. Annotated tag v0.11.2 points to 7e4147babcc877adf68347cba2e05d69401ce022. Do not move it.

## What moved

- Live prose is in src/prompts/live.md and src/prompts/gpt-live.md. Gemini/Realtime bytes match the old template; GPT-Live trims the Markdown final newline to preserve its old wire text. Protocol-specific instructions remain separate.
- src/live/providers.ts owns Live model IDs. Local T3 profile schema derives from SUBAGENT_TYPES, without importing host code across the web build boundary.
- Shared runtime owners: src/output-buffer.ts, src/job-delivery.ts, src/delegation-environment.ts, src/session/identity.ts. Consumers/tests use the new homes without compatibility reexports. Buffer, signal/ACK/cancellation behavior, credential stripping and synthetic session paths remain unchanged.
- Bootstrap source moved to web/die-web-bootstrap.mjs. All three builders still package it as bootstrap.mjs. The candidate builder is a non-adopted research utility with distinct inputs/gates; only its bootstrap source path changed. No new shared packager was justified.
- scripts/select-release-notes.ts validates tag against package version, then selects nonempty notes for that version before publication. No hardcoded old-version notes.

See [placement audit](../quality/code-placement-audit.md), [Live cleanup](../quality/live-placement-cleanup.md), and [packaging cleanup](../packaging/web-bootstrap-placement-and-release-notes.md).

## Work and review

Workers started at 008fdf4. Worktrees stay under /home/tnfssc/.die/worktrees/:

| Work | Directory | Branch | Worker commit / integrated commit |
| --- | --- | --- | --- |
| Prompts/config | die-a86675007a5e-task_e23fad3b | die/consolidate-prompts-and-metadata-e23fad3b | 1b1b076 / 4371a9e |
| Runtime contracts | die-a86675007a5e-task_15754783 | die/move-shared-runtime-contracts-to-clear-o-15754783 | 21f4cf8 / 7b8859e |
| Packaging | die-a86675007a5e-task_471cff38 | die/consolidate-web-packaging-ownership-471cff38 | 2f5bba1 / 488c191 |
| Independent review | die-a86675007a5e-task_404a4fbf | die/review-v0.11.2-integrated-cleanup-404a4fbf | read-only, ef1b283 |
| Ledger test fix | die-a86675007a5e-task_af528501 | die/fix-release-ledger-test-timeout-af528501 | 76b2065 / 6a270f3 |

Independent review approved 008fdf4..ef1b283 with no blocker. It checked moved prompt bytes, extracted signal behavior, identity/bootstrap preservation, env scrub consumers, imports and release-note selection. Its worktree lacked full dependencies; partial tests were not full-gate proof. Runtime worker also used a placeholder archive for execute tests. Parent full production builds below supersede those limited checks.

## Release failure and fix

Initial hosted CI 36110554541 passed at d13ea62, but Release dry run 36110554528 failed. The ledger eviction test performed 261 serial durable reservations and exceeded Bun's 5000 ms default. Its unfinished async work explains the later path-count assertion seeing one active path. This did not establish a runtime leak.

The fix seeds a valid full ledger for setup, then uses real durable operations to test eviction, reopening and replay. Persisted-content assertions are stronger; no runtime change, capacity reduction or timeout increase. Parent focused native-routing tests passed 15/15. The concurrent churn test still requires zero active serializer paths. See [ledger note](../t3/t3-v2-native-root-review-fixes.md).

## Final proof

- Full local shared gate ran with Bun 1.4.2 and mise exec node@24.21.0 npm:pnpm@11.27.1 -- bun run ci. Passed both before and after the ledger fix. Final code at b83db78: root 1057 passed / 17 existing opt-in skips / 0 failed; web 260 backend + 158 model + 26 contracts + 9 projection tests passed. Format/lint/typecheck, full production CLI/web build, offline transport and standalone smoke passed. Logs: artifacts/ci/ and /tmp/die-v0112-local-ci-final.log.
- Pushed exact release candidate 7e4147babcc877adf68347cba2e05d69401ce022. Hosted Linux/macOS CI [36112079191](https://github.com/tnfssc/die/actions/runs/36112079191) passed.
- Full Release dry run [36112079204](https://github.com/tnfssc/die/actions/runs/36112079204) passed at that same SHA, including native Mac helper, cross-platform assets and actual Mac packaged binary/old updater gates.
- Tagged that SHA. Tag workflow [36113061004](https://github.com/tnfssc/die/actions/runs/36113061004) passed. It reused exact-SHA assets, skipped duplicate full builds, repeated actual Mac binary/updater verification and published successfully.
- GitHub reports v0.11.2 as latest, non-draft, non-prerelease. All 12 expected assets are nonempty: four platform binaries, their four SHA256 files, LICENSE, SOURCE.txt and both notice/license bundles. No unnecessary binary downloads or local install. No paid provider/device calls.

Update: die update, restart, then die --version should report 0.11.2.

Wisdom records moves, review, failed gate and final proof. Values were reviewed after broad review and release. No further change: value 3 was already clarified during the audit, and existing honest-proof/resource values cover the CI lessons. Matching names alone still do not justify merging distinct trust boundaries.
