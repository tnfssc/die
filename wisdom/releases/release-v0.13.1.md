# v0.13.1 release coordination

User requested all current workspace changes. Candidate is prepared on develop in the shared checkout /Users/sharath/Private/home/Code/die. No dirty changes were discarded or excluded. Includes all commits since v0.13.0, Live canonical tool rendering, bounded/authorized capability probes, current shared prompt/capability guidance, transcript layout fix, tests, and feature wisdom.

Version: 0.13.1. Candidate commit: bf4ec93497233acac83f47a0b5681b019ef80cba, pushed to origin/develop. Published: https://github.com/tnfssc/die/releases/tag/v0.13.1 at 2026-09-26T06:24:38Z. GitHub latest, non-draft, non-prerelease; all 12 expected assets uploaded and nonempty. Evidence: v0.13.1-publication.json. No published binaries downloaded for redundant hash checks. No release blockers remain.

Hosted CI: https://github.com/tnfssc/die/actions/runs/36223053289
Release dry run: https://github.com/tnfssc/die/actions/runs/36223053349
Hosted CI and release dry run passed. Annotated tag v0.13.1 pushed at the exact candidate SHA.
Tag publication workflow: https://github.com/tnfssc/die/actions/runs/36223564244 (passed: exact-SHA dry-run assets reused, actual Mac binary/old updater gate passed, stable publish passed).

Local checks passed: format, lint, TypeScript, macOS source-only offline transport probe, Live suite (246 passed, 3 skipped, 0 failed; 21,595 assertions), prompt/preview suite (15 passed; 173 assertions), and git diff --check. Log: artifacts/release-v0.13.1-local.log (local ignored artifact). Hosted gates passed: Linux and macOS CI, full release dry run including cross-platform builds, native helper and old-updater tests, then exact-SHA tag publication.

Read-only scope review found no clear code-level blocker. Notes: Pi private _emit rendering seam remains compatibility-sensitive; research tools remain opt-in and require private-input disclosure; refusal-recovery claims must stay limited. Scope ambiguity in the reviewer’s initial snapshot is resolved by the version bump and support/release-v0.13.1.md. Review delegated in shared workspace; no independent code worktree needed. Existing capability-fix worktree is recorded in ../live/capability-refusal-fix-handoff.md.

No fresh paid-provider probes or microphone/speaker acceptance in release coordination. Existing behavioral evidence is limited; guidance is not a guarantee against model refusals. Transcript row coverage does not guarantee arbitrary terminal wrapping.

Values reviewed; unchanged: real-path verification, honest evidence, and preserving user work already cover this release.
