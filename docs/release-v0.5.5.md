# v0.5.5

- Update bundled T3 Code to official preview `v0.0.43-preview.20260921.2045`, pinned at `b488c57f3f9f1688e31c53daee99e29dd1d0baa2`. This is the preview channel, not nightly; upstream marks it as a prerelease.
- Preserve Die native Pi delegation, worktrees, browser/terminal lifecycle, and local web security protections.
- Fix preview integration for SQLite bindings and scoped native-usage snapshots.
- Add current-production-to-preview migration and fresh-process restart regression coverage.

Validated with 743 core tests (14 expected skips), focused semantic/resource tests, and Linux x64 packaged native/browser, migration, relocation and Host/Origin security acceptance. Other platform binaries are built by release CI; local execution coverage is Linux x64.
