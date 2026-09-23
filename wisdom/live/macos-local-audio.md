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
