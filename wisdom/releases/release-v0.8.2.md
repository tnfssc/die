# Stable v0.8.2 Mac startup patch

## Scope and review

Worker commit `519e6ce` reviewed against `origin/develop` (`ef91be5`). Explicit mixer-to-voice-processing-output connection and route-derived format follow Apple’s sample; plausible fix, root cause not proven. Distinct startup stages and bounded NSError details improve diagnosis, but Swift catch cannot catch Objective-C graph exceptions. Independent review found no further concrete graph issue and identified arbitrary token-shaped error domains; parent tightened domains to known system/synthetic values and added regression coverage. Worker formatting normalized before release.

Local validation: Bun 1.4.1 frozen dependency install; `bun test tests/live-lab*.test.ts`: 47 pass, 0 fail, 424 assertions (8 files); `bun run check` passed. No physical devices, provider/paid calls, secret reads or local application installation. Linux virtual signal tests are not real-provider/physical-device end-to-end support proof.

Use existing tag-triggered Release publication gates, not duplicate full matrices: Mac compilation/native device-free tests, full release/build/web/PTY gates, embedded helper and updater tests before stable publication. Publication pending; update this note with exact run and assets afterward.

Release workspace `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_94b222ea`, branch `die/validate-and-release-mac-voice-graph-fix-94b222ea`. Independent review workspace `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_94b222ea-a86675007a5e-task_9e45ab53`, branch `die/review-mac-startup-patch-9e45ab53` (no edits).

Values reviewed; unchanged because bounded diagnostics, testing the packaged artifact, and stating proof limitations are existing values, not new general lessons.
