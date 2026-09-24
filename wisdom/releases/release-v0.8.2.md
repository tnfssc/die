# Stable v0.8.2 Mac startup patch

## Scope and review

Worker commit `519e6ce` reviewed against `origin/develop` (`ef91be5`). Explicit mixer-to-voice-processing-output connection and route-derived format follow Apple’s sample; plausible fix, root cause not proven. Distinct startup stages and bounded NSError details improve diagnosis, but Swift catch cannot catch Objective-C graph exceptions. Independent review found no further concrete graph issue and identified arbitrary token-shaped error domains; parent tightened domains to known system/synthetic values and added regression coverage. Worker formatting normalized before release.

Local validation: Bun 1.4.1 frozen dependency install; `bun test tests/live-lab*.test.ts`: 47 pass, 0 fail, 424 assertions (8 files); `bun run check` passed. No physical devices, provider/paid calls, secret reads or local application installation. Linux virtual signal tests are not real-provider/physical-device end-to-end support proof.

Use existing tag-triggered Release publication gates, not duplicate full matrices: Mac compilation/native device-free tests, full release/build/web/PTY gates, embedded helper and updater tests before stable publication. Publication completed; exact proof below.

Release workspace `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_94b222ea`, branch `die/validate-and-release-mac-voice-graph-fix-94b222ea`. Independent review workspace `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_94b222ea-a86675007a5e-task_9e45ab53`, branch `die/review-mac-startup-patch-9e45ab53` (no edits).

Values reviewed; unchanged because bounded diagnostics, testing the packaged artifact, and stating proof limitations are existing values, not new general lessons.

## Published proof — 2026-09-24

- Stable latest: https://github.com/tnfssc/die/releases/tag/v0.8.2 ; published `2026-09-24T04:51:45Z`, draft=false, prerelease=false. Annotated tag targets `d3c8181e809885357ad35f950baba4a3a5068074`; no tag/assets replaced.
- All four Release jobs succeeded: https://github.com/tnfssc/die/actions/runs/35956568739 . Mac Swift compilation, ASan/UBSan native core tests, device-free protocol/self-test; 858 deterministic tests passed (0 failures); standalone smoke; all four stable target builds; web backend 67, cache regressions 135, terminal recovery 38 tests passed. Formatting/typecheck/lint passed (lint retains repository warnings/info).
- Actual Mac stable executable passed embedded native helper self-test/protocol v1 in isolated HOME with no devices. Linux and Mac old-updater checks passed checksum rejection/preservation, replacement SHA256, and `--version 0.8.2`. Gate compiles pinned v0.7.1 updater source with current toolchain, not the historical full published binary.
- Latest API exposes 12 nonempty stable assets. Downloaded four checksum files and SOURCE.txt; their hashes match release API digests, and all four checksum contents match binary API digests. Binaries were not installed/exercised locally. Embedded helper SHA256: `b09829834e74601905ea79e2cc390b0211e039275bb66663d91964002d482af4`.
- Refetched origin/develop remained `ef91be5ee5cb3f92c5bed2ab5f82e5bc2c220d97`, an ancestor of release. Integrate release plus this proof by ordinary fast-forward push, no force. Documentation-only proof uses skip-ci to avoid a duplicate full develop release matrix after successful tag gates.

| Binary | Bytes | SHA256 |
| --- | ---: | --- |
| die-android-arm64 | 208074496 | fc732cb95dcd28c50d6c678e679f220d1ca85a7db05f320baf92ef1f3dac48e5 |
| die-darwin-arm64 | 182979170 | 66d31c9eefbdf389a31ad189bdbf202f2862f5e7e5c002af2db4ff60cb350cd7 |
| die-linux-arm64 | 200853800 | 1417b94ca483fe9a999ce2eaca2c0ec0aebb5a658cd673c52d249a751c6c1d1e |
| die-linux-x64 | 200967648 | 3c8453ff9436bf126b7b6eeaffd9c30beb0c29e5b9c45013d7c06ab587c998b2 |

User path: `die update`, start a fresh `die` session, optionally run device-free `die --live-lab-self-test`, then `/live-lab mic-check` with explicit device consent. Root cause remains plausible, not proven; no observed physical/TCC/acoustic/provider repair. Linux virtual signal tests do not prove end-to-end real-provider or physical-device support. No physical devices, paid/provider calls, secret reads, or local app installation used.
