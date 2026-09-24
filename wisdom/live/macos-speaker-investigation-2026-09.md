# Speakerphone investigation after stable 0.9.0

Status: research/diagnostics candidate, not a working-speakerphone claim. User reports headphones work but built-in MacBook playback immediately self-interrupts; this falsifies any claim that enabled/unbypassed flags established acoustic AEC. No provider/device calls or configuration changes were made.

## Work and recovery

Parent integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ed4e88a2; branch die/investigate-real-mac-speaker-echo-self-i-ed4e88a2. Base a647e161968ac9a2adccc21a0867fbd3a098a7fb. Nothing published.

- Initial reference audit (stopped after tool syntax failure; no result): /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ed4e88a2-a86675007a5e-task_91983f8c; branch die/reference-audio-engine-source-audit-91983f8c.
- Current implementation: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ed4e88a2-a86675007a5e-task_de751d5f; branch die/current-capture-and-interruption-audit-de751d5f; original commit 925d5b6, integrated as 713f797. See [exact graph/lifecycle audit](macos-speaker-current-audit.md).
- Bounded diagnostics: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ed4e88a2-a86675007a5e-task_669f855d; branch die/bounded-interruption-diagnostics-669f855d. No audio behavior/VAD/gating changes requested.

- Replacement focused reference audit: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ed4e88a2-a86675007a5e-task_7680d571; branch die/focused-upstream-source-comparison-7680d571.

## Concrete production-native comparison

See [native Telegram source chain](macos-speaker-telegram-source.md): pinned app → tgcalls → tg_owt. Unlike a flag-only comparison, this traces actual mixed far-end 10 ms frames into ProcessReverseAudioFrame, capture processing with stream delay, and Mac device timing passed via SetVQEData. This is a software APM alternative, not proof that Apple same-engine processing is wired incorrectly.

## Independently checked provider behavior

Current [Gemini Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities), found using tvly search on 2026-09-24, documents that automatic VAD detects interruptions, cancels/discards generation, and reports interruption via BidiGenerateContentServerContent. Continuous automatic audio detection is distinct from client activityStart/activityEnd when automatic detection is disabled. audioStreamEnd is for a paused input stream, not a playback boundary. Our src/live-lab/session.ts enables automatic detection and increments playback epoch only on serverContent.interrupted; src/live-lab/playback.ts turnComplete merely releases a sub-frame tail, while interrupt drops old pending bytes and flushes generation. Therefore server cancellation, local lifecycle error and acoustic residual must be distinguished, not treated as the same event. Recognizable far-end speech in processed capture would establish an uplink echo defect; an interruption event alone does not.

## Proof limits / gates

Linux only here. Existing native C ring/render tests passed in current audit; these test no Apple audio processing. No new Swift/macOS compilation or acoustic measurement yet. Native Mac CI compile is mandatory before accepting any native correction. Existing .github/workflows/live-lab.yml macos-helper builds with scripts/build-live-lab-helper.sh, runs C sanitizers and device-free --self-test/stop smoke. Running an unpublished candidate through remote CI needs parent review first; do not publish just to obtain that proof. CI success still does not establish speakerphone AEC or double-talk. No changes to separate CI/dependency PR work.

Values unchanged: existing evidence-before-claim, user-platform validation and safe ownership values already apply.

## Diagnostic candidate and repeatable offline validation

Original bounded-metadata worker commit 070341b integrated as 06fd32a. Retains only validated native ready processing flags/rates, counts provider interruptions and normal turn completions separately, and records latest interruption monotonic time. `/live-lab status` exposes provider interruption count and native processing configuration; missing metadata is unknown, never a zero/pass. No waveform/transcript/secret logging, no change to capture, render, VAD, startup, interruption handling or agent jobs. These observations identify event source, not acoustic cause; actual residual-vs-false-VAD requires consented processed capture/render comparison.

Validation on this integration tree: 61 tests across 8 files passed (485 assertions): live-lab-audio, audio-lifecycle, playback, session, extension, orchestration, tools and live-host-bridge. C core passed clang ASan/UBSan. Typecheck passed after prepare-assets. Used existing Bun 1.4.1 executable at /home/tnfssc/.local/share/mise/installs/bun/1.4.1/bin/bun and a temporary local node_modules symlink to /home/tnfssc/Code/die/node_modules (SDK 2.24.0; Pi 0.87.1 adapter hash verified by prepare-assets). No installs or edits to that dependency tree. Direct fresh-worktree SDK tests first failed due missing dependencies, not product failures. Project mise trust was not changed.

Repeat: `bun test tests/live-lab-{audio,audio-lifecycle,playback,session,extension,orchestration,tools}.test.ts tests/live-host-bridge.test.ts`; `clang -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined native/live-lab/AudioCore.c native/live-lab/test-core.c -o /tmp/live-lab-core-test && /tmp/live-lab-core-test`. On Mac run `sh scripts/build-live-lab-helper.sh` and helper `--self-test`; neither opens devices. No native Swift changes in this candidate; Mac compile remains required before accepting native changes. These tests prove lifecycle/full-duplex forwarding, not echo cancellation.
