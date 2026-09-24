# Stable 0.9.1 — diagnostic speaker check

Authorized normal patch release; not a proven echo fix. Implementation/recovery and acoustic limits: [local speaker check](../live/local-speaker-check.md). Integration branch `die/add-actionable-local-mac-speaker-echo-ch-c71f40f3`. Latest origin/develop including merged CI speedup was merged; prior candidate diagnostics retained. Native audio graph and job bridge unchanged; only two native ready channel-count fields added.

Local validation: 89 focused tests across 13 files passed (689 assertions); final engine suite passed 14 tests/123 assertions including the actual six-second timeout and cleared-frame ownership tests. Typecheck, formatting and lint passed (existing repository warnings/info); C core passed clang ASan/UBSan. Dependency setup used existing local node_modules via temporary symlink and explicit Bun 1.4.1, without changing mise trust. No actual audio devices, provider credentials or paid APIs.

Publication uses the existing single tag-triggered Release workflow with native macOS compile/helper self-test/sanitizers, full build/tests, existing four binaries and actual Mac release/updater smoke gates. No extra matrix or downloaded published binaries just to rehash them. Publishing is gated by all normal release checks. Release notes explicitly say diagnostic, not echo fix; automatic correlation does not establish speech double-talk/barge-in or absolute AEC quality.

Published: https://github.com/tnfssc/die/releases/tag/v0.9.1 . Annotated tag targets `927551015b63fd027e7ec06c02f5715ad559af4b`. All normal release gates passed: https://github.com/tnfssc/die/actions/runs/35965351525 . Full deterministic suite: 911 pass, 15 skip, 0 fail across 127 files (926 tests). Native Swift compile, C sanitizers, helper self-test/protocol, standalone smoke, existing four release builds and actual Mac embedded-helper/updater passed. Linux and Mac old-updater checks compile pinned v0.7.1 updater source with the current toolchain (not the historic full executable). Web backend 67, cache 135 and terminal recovery 38 tests passed. No acoustic or provider session validation is claimed.

User command: `die update`, restart `die`, then `/live-lab speaker-check`; lower output volume and stay quiet after accepting explicit consent.

Values unchanged: existing truthful evidence, bounded resource ownership and platform proof apply.

Latest-release API verified `v0.9.1`, published 2026-09-24T06:47:58Z, draft=false, prerelease=false, all 12 expected assets nonempty (four raw executables, four SHA256 files, LICENSE, SOURCE.txt, notices and licenses). First API read timed out; one retry succeeded. No published executables downloaded or installed. Develop remained at aac8425 and an ancestor of the tested release immediately before ordinary fast-forward integration. Documentation-only publication commit uses skip-ci to avoid rerunning the full matrix already passed at the tag.
