# Stable 0.9.2 — Mac native Live promotion

User authorized review and normal stable publication of upstream e86c52a. Latest published release was queried as v0.9.1 (9275510); reviewed the full intervening history, not the parallel unfinished OpenAI provider work. Release owner branch: die/review-mac-changes-and-release-a94cd94c; worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_a94cd94c. Remote develop was e86c52a at initial fetch. Preserve remote commits with ordinary fast-forward pushes only; no force or tag replacement.

## Decisions and evidence boundaries

Preserved native full-duplex Mac audio, bounded 60–80ms playback reserve/write credit, native drain/tails/interruptions, /live toggle and autocomplete, captured-speech handoff authority, received-order persisted transcripts, private branch-only bounded snapshots, general-purpose prompt, and PCM-driven footer. Native AudioCore is unchanged since v0.9.1; Swift changes are names/paths, not a new DSP graph. Linux's unsupported native Live path must not drive reversal of Mac-proven fixes.

Prior user Mac evidence: native-live-promotion.md records that the installed playback candidate works well. Prior Mac builds and installed helper self-tests passed; the final waveform candidate hash was e073dddfb1280835dc149297f87f2dc7412f1d142e7f4e70d20e4af515da0507. Its 192 Live/footer tests and width checks are recorded in voice-waveform.md, but physical Ghostty appearance still awaited user trial. Transcript/prompt candidate had 169 Live tests and onboarding/helper checks; old paid synthetic-speech probes used fake hosts, not actual weather/export work, and optimistic no-work narration remains a known prompt limitation. Those historical probes are not fresh release proof.

This Linux release review uses no physical devices, provider calls, or provider secrets. It does not prove acoustic quality, all routes/double-talk, physical waveform appearance, or installed real-agent export. Preserve these limits in release notes.

## Narrow blocker and local gates

Upstream develop Release run 35988433701 and CI run 35988433617 stopped at formatting in tests/live-host-access.test.ts and wisdom/live/voice-prompt-behavior-probe.ts. Applied only formatter output; no behavior edits and no probe execution. Version and release notes updated to 0.9.2, including the release workflow notes-file path.

Explicit Bun 1.4.2, existing dependency symlink, no mise trust changes: typecheck and format passed; lint passed with existing warnings/info. Packaging/release/install/embedding/platform checks: 27 pass, 0 fail, 271 assertions across 4 files.

Independent Mac lifecycle reviewer: 106 device-free tests passed across 7 files; no blocker or code change. Branch die/review-mac-live-lifecycle-13e82e78, worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_a94cd94c-a86675007a5e-task_13e82e78.

Transcript/prompt/waveform review: 85 focused tests and typecheck passed. Found and fixed one narrow boundary defect (worker commit 24236a5): a final segment ending exactly at the 4096-character persistence boundary was incorrectly labeled partial. The fix preserves final status on the last full chunk; regression covers 4096 and 8192 characters. Parent reviewed and integrated it without changing captured-speech authority or audio behavior. Branch die/review-live-transcript-prompt-waveform-6b749a74, worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_a94cd94c-a86675007a5e-task_6b749a74.

Parent integration verification: 50 transcript/host/extension tests passed (309 assertions), followed by typecheck and format. The full matrix is reserved for the publication workflow.

## Publication

Use the existing tag-triggered Release workflow once (no duplicate full pretag matrix). Existing reuse lookup may fall back to normal complete gates because no matching successful dry run exists. Native Mac compile/C sanitizers/protocol, deterministic suite, web checks, four binaries, embedded helper, compiled version and old updater checks gate publication. After success, query release metadata/assets without downloading binaries merely to rehash them, then fast-forward develop with documentation-only skip-ci evidence. Publication completed as documented below.

Values unchanged: existing platform-proof, truthful evidence, safe ownership, bounded-use and simple-design values already cover this release. This note adds release-specific evidence, not a new general rule.

Published https://github.com/tnfssc/die/releases/tag/v0.9.2 at 2026-09-24T11:06:57Z. Annotated tag targets 5d1a34eb00fc52474d812e56ae6bb24712b8abe9. Single normal Release run passed: https://github.com/tnfssc/die/actions/runs/35990066864 . No duplicate pretag full matrix or tag replacement.

CI: 929 deterministic tests passed, 15 skipped, 0 failed. Format/lint/typecheck, compiled CLI build and standalone smoke, native Mac C ASan/UBSan and Swift helper compile/self-test/protocol, four binary builds, web backend/cache/terminal gates and license/source/checksum generation all passed. Actual Linux and Mac release binaries passed checksum-failure preservation and successful replacement/version checks using pinned v0.7.1 updater source compiled with the current toolchain (not the historical full executable). Both reported --version 0.9.2. The actual Mac release payload also passed embedded-helper self-test and protocol v1 from isolated HOME/PATH, without devices.

Latest release API confirmed v0.9.2, draft=false, prerelease=false, with all 12 expected assets uploaded and nonempty: die-linux-x64 (200922592 bytes), die-linux-arm64 (200919336), die-darwin-arm64 (182896626), die-android-arm64 (208140032), their four SHA256 sidecars, LICENSE, SOURCE.txt, THIRD_PARTY_NOTICES.md and THIRD_PARTY_LICENSES.txt. Relied on CI hashes/actual-payload tests; did not download published binaries just to rehash or install them.

Before develop integration, freshly fetched remote still pointed to e86c52a, an ancestor of the released source. Publication evidence uses a documentation-only [skip ci] commit, then an ordinary fast-forward push, preserving user commits and keeping unfinished OpenAI provider work excluded.
