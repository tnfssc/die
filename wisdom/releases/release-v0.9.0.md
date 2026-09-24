# Stable v0.9.0: session voice orchestration and explicit native processing

Release workspace: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d44fa40b; branch die/integrate-and-release-voice-jobs-and-ech-d44fa40b. Review workspace: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d44fa40b-a86675007a5e-task_e52463ee; branch die/review-combined-voice-integration-e52463ee. Independent review of combined bebcd22 found no concrete integration failure; no edits.

User authorized normal stable publication and develop integration. Remote latest was v0.8.2; v0.9.0 was absent. Minor version reflects new voice-to-current-session agent/jobs functionality. Includes bridge ce790a6 and review fixes d34158c, 6451b38, 905cb8a, plus echo 4221296 cherry-picked as bebcd22. Echo commit already contains 4bff0ab research verbatim; no duplicate cherry-pick. origin/develop 7db8b85 is an ancestor.

Read values, feature orchestration/research, and release verification preference. Existing values cover truthful evidence, bounded authority, and packaged-artifact checks; values unchanged.

Local focused gate: 54 tests, 272 assertions pass (seven bridge/extension/orchestration/tools/job-service/native-routing files), typecheck, format and lint pass (existing warnings/info). First attempt omitted prepare:assets and failed importing photon WASM; prepared assets and reran successfully. No full local release matrix: use existing tag-triggered workflow once, including native Mac compilation, ASan/UBSan, protocol/self-test, full deterministic/build/web/PTY checks, actual Mac embedded helper and old-updater verification before publishing. No devices, paid APIs, secret reads, or real user-job cancels. Local logs under /tmp are ephemeral, not durable evidence.

Exact trimmed completed transcription is required, not semantic transcript matching or speaker authentication. Missing completion markers/paraphrases/expired turns fail closed. Polling observes bounded scoped snapshots (first 20 and known active), not exhaustive native events. No real conversation proof. Echo explicitly sets bypass=false and verifies ready diagnostics, retaining v0.8.2 graph; AEC/double-talk and physical Ghostty startup remain unverified. See wisdom/live/live-lab-orchestration.md and wisdom/live/macos-speaker-echo-research.md.

Publication gates succeeded; integrate release plus this documentation-only proof into develop by ordinary fast-forward push with skip-ci, avoiding a duplicate full release matrix. No force-push or tag replacement.

## Published proof — 2026-09-24

- Latest stable: https://github.com/tnfssc/die/releases/tag/v0.9.0; published 2026-09-24T05:51:57Z, draft=false, prerelease=false. Annotated v0.9.0 targets 6a02a2213624462e099dd7e545bc71d70dc3fe1e.
- All four normal Release jobs passed: https://github.com/tnfssc/die/actions/runs/35960918890 . Mac Swift helper compilation, ASan/UBSan core tests and device-free protocol/self-test passed. Deterministic suite: 878 pass, 15 skip, 0 fail across 123 files; standalone smoke and all four target builds passed. Web backend 67, cache regression 135, terminal recovery 38 tests passed. Format/lint/typecheck passed.
- Actual Mac stable executable passed embedded native helper self-test/protocol v1 with isolated HOME and no devices. Linux and Mac updater gates verified checksum rejection preserves the executable, replacement SHA256, and compiled --version 0.9.0. Old-updater gate compiles pinned v0.7.1 updater source with current toolchain, not the historical full binary.
- Latest-release API verified 12 nonempty expected assets (four executables + four checksums + LICENSE, SOURCE.txt, notices and licenses); executable API digests below. No redundant binary download/install. Stable updater asset names unchanged.
- Refetched origin/develop still ancestor of release before integration. No physical Ghostty/Mac startup, live conversation, acoustic AEC/double-talk or exhaustive native polling proof is claimed.

| Binary | Bytes | API SHA256 |
| --- | ---: | --- |
| die-android-arm64 | 208140032 | f83b6f00106d3afa8ab42d2a379e4699a0603c5227056cf81e6c49c54fb4e36a |
| die-darwin-arm64 | 182995682 | d7c7eb334f9dc7176538ec3e2d2f294bdba5a452ad6c7dfed8062cbf2d89e1f8 |
| die-linux-arm64 | 200919336 | 116541d1e25153902c2fa7f7e42e02655cf9aead53bf49cf8c3aa8d0bf76de50 |
| die-linux-x64 | 200979936 | 730129c338ba57eb97812d8932f0eaa7804c326d1b04e61e3e6a26b2433df743 |

User path: `die update`, restart `die`, then `/live-lab`. Feature research and release wisdom updated; values unchanged because existing principles already cover the findings.
