# CI trigger deduplication

Changed `.github/workflows/ci.yml` so push CI runs only on `develop`, pull-request CI remains enabled, and workflow/PR-or-ref concurrency cancels superseded runs. Job and step content was preserved.
