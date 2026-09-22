# T3 nightly switch and release

User requested switching bundled T3 Code from stable to nightly and publishing a release when done (2026-09-22). Starting HEAD c6fe280, develop, clean; latest published version 0.5.4. Proposed next patch release 0.5.5.

Implementation delegated to task_bb27ba6d in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_bb27ba6d, branch die/switch-bundled-t3-code-to-nightly-bb27ba6d. Worker discovers official nightly, pins commit, rebases patch and validates build. Parent integrates/reviews then versions, validates core, pushes develop and signed release tag, monitors CI and confirms assets/publication. Do not automatically download binaries for checksum verification (see release-verification-preference.md). No local install requested.

Status: implementation running; no release changes or tags yet.

## Blocked pending channel decision
Worker completed evidence/docs commit bacda4562aa7c87c940ddf9b8bd3daedae3e8224. Latest nightly v0.0.43-nightly.20260922.2083 (0141bc2bf5fcf52a563240a6bce4b58050496db5) lacks v2/native integration sources; current pin is v2, not stable. Canonical patch cannot apply. Details in [upgrade investigation](t3-nightly-upgrade.md), copied with status doc into parent workspace. No product change or release. Ask user whether to use distinct upstream preview channel instead; do not silently substitute or remove native capabilities.

## Preview investigation authorized
User approved investigating preview compatibility, not yet switching to it. Task task_8a2c4ca2 runs in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8a2c4ca2 on die/investigate-t3-preview-compatibility-8a2c4ca2. Scope: official preview identity, ancestry/patch compatibility, native features and build/test probes; report recommendation before canonical product changes or publication. Prior release request remains conditional on completing an agreed upgrade.

Preview investigation complete: report commit b43f864 copied to parent notes. Feasible candidate with three conflict files and SQLite binding correction; workspace typecheck/build, 5464 web tests and 154 focused server tests pass. Canonical unchanged. Need user authorization for preview adoption followed by live/native/migration/security/packaging acceptance before release. See t3-preview-compatibility.md for persistent candidate locations and evidence.

## Preview adoption and release authorized
User said “yes ofc” to adopting preview and releasing after remaining checks. Implementation/acceptance task_49d9fc83 running in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83, branch die/adopt-t3-preview-and-validate-release-re-49d9fc83. Parent handles final review, versioning, push/tag and publication. No further channel confirmation required. Preserve no-auto-binary-download release preference.

Adoption progress: worker commits 51f8f7d (pin/candidate), dc69a3c (docs), 52a3882 (semantic native usage snapshot scope fix). Exact final patch source verification passed. Packaging/security, live/browser/migration, resource gates delegated; not yet ready to integrate/release. Owner notes at worker .agents/notes/t3-preview-adoption.md.

## v0.5.5 release preparation
Adoption task completed at f3d7545 and merged into develop with all evidence notes. Core 743 pass/14 expected skips; 292 focused semantic/resource tests; exact-binary live/native/browser/worktree/security/package and current-production migration/restart all passed. Parent independently verified exact final source against merged pin+patch. Parent format/lint/typecheck/tag check/diff check passed (lint warnings remain).

Parent format check initially discovered historical experiments added by pre-task c6fe280 were included in root checkout but not worker format run. Explicitly excluded archived experiments/ in Biome (outside tsconfig/product tests) rather than reformatting historical research. Runtime checks/harnesses remain included. Bumped package to 0.5.5, release notes docs/release-v0.5.5.md. No local install. Remote develop has no unseen commits; next step signed commit/tag and non-force push, monitor CI, confirm publication without automatic binary downloads.
