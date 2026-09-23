# v0.5.5

- Update bundled T3 Code to official preview `v0.0.43-preview.20260921.2045`, pinned at `b488c57f3f9f1688e31c53daee99e29dd1d0baa2`. This is the preview channel, not nightly; upstream marks it as a prerelease.
- Keep Die native Pi delegation, worktrees, browser and terminal lifecycle, and local web security checks working.
- Fix preview integration for SQLite bindings and scoped native-usage snapshots.
- Add regression tests for moving from current production to the preview and restarting in a fresh process.

Checks passed with 743 core tests and 14 expected skips. Focused semantic and resource tests also passed, along with packaged Linux x64 native, browser, migration, relocation, and Host/Origin security checks. Release CI builds the other platform binaries. Only Linux x64 ran locally.
