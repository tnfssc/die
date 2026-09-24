# Native Live packaging promotion — 2026-09-24

Packaging half of the /live-only promotion. Worktree: `/Users/sharath/.die/worktrees/die-f528e86af6b5-task_733f377a`; branch: `die/promote-live-packaging-and-cli-733f377a`. Integrate with the runtime worker before building the whole CLI.

- Native directories, helper/build/plugin names, acceptance scripts and existing workflows use Live names. CLI registers one `die-live` extension and exposes `--live-self-test`; build embedding uses `--live-helper=` and intercepts `src/live/embedded.ts`. Native code changes are names only; audio rings, processing and protocol remain unchanged. Linux route variables are `LIVE_SOURCE` / `LIVE_SINK`.
- Local install builds/embeds the helper only on Darwin arm64. `DIE_SKIP_BUILD=1` skips both builds for a trusted prebuilt. Stage one executable, probe `--version` and (Darwin arm64) embedded-helper self-test, then atomically rename. Failed probes leave the previous executable intact and remove staging files. No installed sidecar required.
- Existing release target selection still embeds only into the Darwin arm64 binary. The optional native workflow candidate also embeds and probes its CLI, rather than merely probing an adjacent helper.

## Proof and limits

Frozen dependency install passed. Installer sandbox tests: 8 pass / 26 assertions, including failed-probe preservation, trusted prebuilt, Mac build arguments and other-platform exclusion. Shell syntax checks passed. Mac helper compiled and device-free self-test passed; hello/stop protocol passed. AudioCore ASan/UBSan tests passed. Standalone compiled plugin fixture retained exact embedded native bytes after the source payload was deleted (SHA-256 `8df4b9e181a9b3077475b87a07abcf64ae0c8bfd97a4eae0a494610bc939c9ef`). The fixture was run with standalone Bun; trying Bun.build inside the coding-tool execution process first failed with InvalidObject.

The three renamed packaging tests currently cannot import the pending runtime modules (3 load errors; installer tests pass). Parent must rerun those after integration and perform full CLI build/self-test. No Linux native compilation, devices, provider/release calls, or user installation performed.

Docs remain parent-owned: native README moved unchanged to `native/live/README.md` and still needs its old names updated. Native workflow now expects parent to rename `support/live-lab-candidate.md` to `support/live-candidate.md`.

Values unchanged: existing truthful proof, small ownership boundaries and verify-before-replace guidance cover this work.
