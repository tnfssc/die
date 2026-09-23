# CI trigger deduplication

`.github/workflows/ci.yml` now runs push CI only for `develop`. Pull-request CI stays on. Workflow and PR-or-ref concurrency cancel older runs. Job and step content did not change.
