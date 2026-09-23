# v0.8.1 diagnostic stable patch

Release owner worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_657b35ea` (branch `die/publish-mac-audio-startup-diagnostics-pa-657b35ea`). Diagnostic source: `722823e43f29ca031cf61c734fc8037f76e8b4cb`. Review worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_657b35ea-a86675007a5e-task_bc849f8b`, branch `die/review-mic-diagnostics-safety-bc849f8b`.

User uses Ghostty, saw no microphone prompt, and prior SoX capture worked. Root cause remains unknown; this is a diagnostic patch, not a verified root-cause fix. See [diagnostic details](../live/live-lab-mac-startup-diagnostics.md). Known stage codes stay allowlisted; arbitrary helper errors/messages are never surfaced. Mic check requires explicit consent, discards buffers and does not use credentials/providers.

Local focused tests: 44 passed across seven live-lab files; format, lint and typecheck passed (existing lint warnings). No devices or provider calls. Linux cannot validate Swift/AVFoundation: tag Release workflow is the required Mac compiler/native/embedded-helper gate before publication. Avoid duplicate pretag full matrix: publish via tag gates, then safely fast-forward develop with release-proof documentation using skip-ci. Fetch/recheck upstream before integration; no force push or tag replacement.

Values unchanged: truthful evidence, consent, safe preservation, and small design already cover this follow-up. Publication proof to be appended after the workflow finishes.

Independent review `e646e41` integrated as `04a670d`: abort mic-check on session change; classify mixer-format lookup as output stage. All 44 focused tests pass after integration. No safety blocker remains in reviewed consent/diagnostics/cleanup paths.

## Published proof — 2026-09-23

- Stable latest release: https://github.com/tnfssc/die/releases/tag/v0.8.1 (published 2026-09-23T20:25:59Z, draft=false, prerelease=false).
- Annotated tag `v0.8.1` targets `afc7d790e8b1c9640999eb9f1960b7040a36967b`; no tags/assets replaced.
- All four Release jobs passed: https://github.com/tnfssc/die/actions/runs/35914454067 . Mac Swift compilation, sanitizer/native protocol/self-test, full deterministic/build/web/PTY checks, actual Mac executable embedded-helper self-test and old-updater gates preceded publication. The updater gate compiles pinned v0.7.1 source with current toolchain, not the historical published full binary.
- Latest endpoint has all 12 nonempty stable assets. Downloaded checksum and SOURCE.txt hashes match release API digests; all four checksum contents match binary API digests. Published binaries were not installed or exercised locally.
- Embedded helper SHA256: `133ab864e0a24bdd8a4f42e48e534a831d3eb1279cfc30568eeb15800de27a5a`.
- Upstream develop re-fetched after publication; remains ancestor (8a40abc). Integrate proof by ordinary fast-forward push, with skip-ci because only documentation follows the fully gated tag. No redundant pretag full matrix.

| Asset | Bytes | SHA256 |
| --- | ---: | --- |
| die-android-arm64 | 208074496 | 3efa6e3c36d39307021ffc6cff73e7557765bbfba8b59b6d3a86a95e72b6bf1e |
| die-darwin-arm64 | 182979170 | af77df0eeb20a0bacd2637378e0f79dd012e72ca95d8a7791d04ef7b3606037d |
| die-linux-arm64 | 200853800 | 379885feac179347b41cb1900e427414aa5d76e1754116c35a506c125d9a19ca |
| die-linux-x64 | 200967648 | 3237f27fd0fa5bd36ad086642604c7bc17da068d0f64b301e11822249f928e61 |

Exact user path: `die update`, then start a fresh `die` session and run `/live-lab mic-check`; accept explicit consent only if ready for native device startup. Optional `die --version` should say 0.8.1. Root cause still unknown; no claim of verified microphone prompt, acoustic or provider fix. No real devices, paid/provider calls, or local user installation used.
