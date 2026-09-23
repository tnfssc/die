# macOS local CLI Live (post-v0.7.0 fix)

## Pickup and scope

- Integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4c4913fb
- Branch: die/add-macos-live-audio-support-4c4913fb
- Audio worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4c4913fb-a86675007a5e-task_22df3d69, branch die/macos-sox-backend-22df3d69.
- Setup worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4c4913fb-a86675007a5e-task_7271eb46, branch die/macos-live-setup-ux-7271eb46.
- Fix prepared for parent review/integration only. Package stays 0.7.0; no tag, publication, or version bump. Historical v0.7.0 release notes correctly describe that released artifact, not this pending fix.
- Local Linux and macOS CLI only; SSH exclusion and no web audio remain. No real keys, paid calls, microphone, or speakers used during development.

## CI and remaining physical acceptance

Existing CI and release workflows both run on ubuntu-24.04; release cross-compiles bun-darwin-arm64 but does not execute it. Added one small macos-15 job to existing CI (no full web rebuild or new workflow): locked Bun dependencies, Homebrew SoX, help-output CoreAudio assertion, real executable discovery, and focused deterministic fake-device/fake-transport Live tests. SoX --help does not open an audio device. Runner label is available in GitHub-hosted macOS offerings; account capacity/permissions and actual execution remain unverified until this branch is pushed and CI runs.

Automated executable discovery proves neither privacy permission nor usable default devices. Physical Mac acceptance still needs a consenting local user to install SoX, enable the terminal application's microphone permission, select working default input/output, explicitly start Live, verify capture/playback, barge-in and stop/error cleanup, and assess latency/echo using headphones. Paid provider validation is a separate opt-in step, not implied by these tests. This Linux development host cannot prove Mac hardware behavior or TCC attribution. CI does not attempt to grant permission or open devices.

## Lesson

The v0.7.0 prototype conflated local with Linux. Locality is a session/device ownership boundary, not an operating system. Check backend/platform capability separately and give platform-specific prerequisites; do not fix unsupported-platform reports by deleting a guard without proving the command/backend contract. Existing values (follow evidence, show what is real, simplest working design, know what a change means) already cover this mistake; values.md stays unchanged rather than creating a duplicate broad rule. Feature-specific evidence and remaining gaps belong here.

Runner evidence: https://github.com/actions/runner-images/blob/main/README.md (retrieved 2026-09-23) lists standard macos-15 as arm64, matching the released Mac architecture. macOS 14 is marked deprecated, so the new job pins macos-15 rather than copying an old runner label.

Setup privacy evidence: https://support.apple.com/guide/mac-help/control-access-to-the-microphone-on-mac-mchla1b1e1fe/mac (retrieved 2026-09-23) documents System Settings > Privacy & Security > Microphone per-app access. Setup identifies Terminal or the app hosting die and notes that first explicit Live start may trigger the OS request; setup itself never requests permission. Restart the hosting app if necessary. Denied/absent hardware remains a start-time failure rather than a false preflight guarantee.

## Backend evidence and choice

Official SoX 14.4.2 source/manual from https://downloads.sourceforge.net/project/sox/sox/14.4.2/sox-14.4.2.tar.gz documents that rec/play imply the default input/output device (equivalent to -d), and the CoreAudio format supports recording/playback with the default device when no device name is supplied. Current official Homebrew formula https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/s/sox.rb installs rec/play aliases, uses upstream CoreAudio detection on macOS, and adds --with-alsa only on Linux. Audio worker retrieved these public sources; no runtime audio probe was performed.

Reuse the existing rec/play command contract: capture mono signed little-endian PCM16 at 16 kHz to stdout, playback mono PCM16 at 24 kHz from stdin. Keep -t raw attached to the pipe, not the device. No explicit -t coreaudio is needed for Homebrew defaults; adding it blindly risks attaching a device format to the PCM pipe. This is actual CoreAudio-backed SoX support, not a claim that ALSA works on macOS. Custom SoX builds/environment device overrides remain the user's responsibility; executable preflight cannot prove them usable. Linux arguments and process lifecycle are unchanged. Requirements are platform-specific, setup says brew install sox and headphone/permission guidance, and unsupported systems/SSH still fail closed.

## Validation in integration worktree

- Linux host, Bun 1.4.1. bun install --frozen-lockfile succeeded.
- Offline suite: 83 passed, 0 failed, 374 assertions across tests/audio.test.ts, live-auth-lifecycle, live-bridge, live-connection-test, live-credentials, live-dispatch-budget, live-extension, live-setup, live-status, live-transport, and release-workflows test files. No opt-in provider acceptance file was run.
- bun run check passed (asset preparation plus TypeScript).
- Full repository format check and lint passed; lint retains pre-existing warnings/informational diagnostics.
- git diff --check passed.
- New tests simulate Darwin executable discovery/missing recorder and SSH, preserve Linux discovery, assert exact common PCM/default-device arguments, startup cleanup, and Darwin setup success/failure/privacy/no-autostart. Existing adapter tests cover queue bounds, interruption, asynchronous child exits, stream failures and listener cleanup.
- macOS CI definition was parsed/tested locally but NOT executed here. No physical Mac, full bundled build/PTY smoke, or paid Gemini validation was performed for this patch. Do not treat the added CI definition as a successful Mac run.
