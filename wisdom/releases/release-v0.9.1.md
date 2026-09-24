# Stable 0.9.1 — diagnostic speaker check

Authorized normal patch release; not a proven echo fix. Implementation/recovery and acoustic limits: [local speaker check](../live/local-speaker-check.md). Integration branch `die/add-actionable-local-mac-speaker-echo-ch-c71f40f3`. Latest origin/develop including merged CI speedup was merged; prior candidate diagnostics retained. Native audio graph and job bridge unchanged; only two native ready channel-count fields added.

Local validation: 89 focused tests across 13 files passed (689 assertions); final engine suite passed 14 tests/123 assertions including the actual six-second timeout and cleared-frame ownership tests. Typecheck, formatting and lint passed (existing repository warnings/info); C core passed clang ASan/UBSan. Dependency setup used existing local node_modules via temporary symlink and explicit Bun 1.4.1, without changing mise trust. No actual audio devices, provider credentials or paid APIs.

Publication uses the existing single tag-triggered Release workflow with native macOS compile/helper self-test/sanitizers, full build/tests, existing four binaries and actual Mac release/updater smoke gates. No extra matrix or downloaded published binaries just to rehash them. Publishing is gated by all normal release checks. Release notes explicitly say diagnostic, not echo fix; automatic correlation does not establish speech double-talk/barge-in or absolute AEC quality.

Publication pending. User command after stable release: `die update`, restart `die`, then `/live-lab speaker-check`; lower output volume and stay quiet after accepting explicit consent.

Values unchanged: existing truthful evidence, bounded resource ownership and platform proof apply.
