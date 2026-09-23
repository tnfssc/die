# v0.5.8 release progress

User authorized push and release after terminal last-used model fix and dependency updates. Integrated CLI worker 2d4ffb1 as 69fd0ec, added real disk-persistence regression coverage in 56caff6, and dependency worker e652c33 as 8d512d0. Pi 0.87.1, no T3 upstream refresh.

Version bumped to 0.5.8 with user-facing notes release-v0.5.8.md. Combined format/typecheck/build/full tests/smoke/tag validation running as task_7ccb72ce. Next: verify results, commit release, push develop and v0.5.8 tag, monitor CI and release, set release notes and verify asset metadata. Do not download binaries solely for checksum verification; no local install requested.

Initial combined run: format, typecheck and build passed; tests 722 pass/14 skip/1 fail in existing job-attention heap-growth threshold (27,480,475 bytes vs 20 MiB). Focused job-attention suite immediately passed all 10. Full suite rerun plus smoke/tag/lint underway in task_d50752ae; logs /tmp/die-v058-{tests,smoke,lint}.log. Do not mistake initial run for passing.

Final local gates passed: full suite 723 pass, 14 skip, 0 fail (4630 assertions); standalone smoke, tag validation, lint (existing warnings), format/typecheck/build and diff check. Paid-provider tests not run. Preparing release commit/tag/push.

Pushed develop and annotated v0.5.8 tag at 05f714eb9cd4434a4ddca4df3638dae010bd76b6. Release run 35820481468 and CI run 35820479228 queued/running, watched via gh run watch. Pending successful publication, asset metadata check and release-note edit. SSH reports unsupported id_rsa but fallback authentication succeeded; push completed.

CI run 35820479228 completed successfully. Release workflow still watched by task_8ef80359.

## Published

Release workflow 35820481468 and CI 35820479228 succeeded. Published https://github.com/tnfssc/die/releases/tag/v0.5.8 at 2026-09-23T05:08:32Z; draft=false, prerelease=false. Verified uploaded binary/checksum assets for Linux x64/arm64, macOS arm64, Android arm64 plus license/notices/source metadata. Release notes set from release-v0.5.8.md. No binary downloads or local installation. Remaining caveats: existing heap-threshold test was flaky on first local run; third-party extensions calling pi.setModel in root TUI share explicit-selection event source (documented in model wisdom).
