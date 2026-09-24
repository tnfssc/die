# Local speaker-check candidate

Integration branch `die/add-actionable-local-mac-speaker-echo-ch-c71f40f3`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_c71f40f3`. Merged origin/develop at aac8425 including CI speedup without discarding the preceding speaker investigation diagnostics.

Worker recovery:
- Engine: `die/local-speaker-measurement-engine-9fb21f12`, `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_c71f40f3-a86675007a5e-task_9fb21f12`.
- UI: `die/speaker-check-ui-and-command-2d604f46`, `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_c71f40f3-a86675007a5e-task_2d604f46` (40700ca).
- Native metadata: `die/capture-graph-channel-metadata-11cae9bc`, `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_c71f40f3-a86675007a5e-task_11cae9bc` (966e750).

## Evidence and limits

No proven Apple graph defect. Headphones working while speakers self-interrupt warrants acoustic evidence, not microphone gating or provider VAD changes. See [investigation](macos-speaker-investigation-2026-09.md), [reference audit](macos-speaker-reference-audit.md), and [native Telegram implementation](macos-speaker-telegram-source.md). The new command is a consented local diagnostic, not an echo fix or absolute AEC metric. The normal native capture/playback/processing and agent-job bridge stay intact. Post-start channel counts expose the documented mono-capture hypothesis without changing negotiated formats.

Only the user explicitly invokes `/live-lab speaker-check` later; development uses deterministic synthetic frames and no devices, credentials, or paid APIs. Physical Mac speakerphone cancellation and double-talk remain unvalidated. Existing release gates compile native Swift and run device-free helper tests, not acoustic validation.

Values unchanged: evidence-before-claim, bounded ownership, and real-platform proof already cover this work.

## Implemented measurement

The 2.3-second acquisition uses 600ms baseline, 1s deterministic low-pass broadband noise with a syllabic amplitude envelope, and 700ms tail. A 10ms edge fade avoids abrupt starts/stops. PCM peak is bounded at 1400/32768 (about -27dBFS maximum); physical SPL is unknown, so consent instructs the user to lower output volume. This speech-like envelope and broadband excitation cover more than a tone, but are not real speech and cannot establish speech double-talk. Playback uses existing 24kHz PCM writes and postprocessed capture uses existing 16kHz callback frames.

Full-rate lag search (0–450ms, both polarities) computes normalized correlation, best-lag linear projection RMS estimate, and baseline/play/tail capture RMS. This is submitted-PCM correlation, not a hardware render tap, ERLE, or absolute AEC quality. Actual device timing, nonlinear processing, drift and room response can reduce correlation. Silence is ambiguous, not a pass. Busy capture, clipping, missing capture and pending playback are explicitly inconclusive/unusable.

The runner has a 6s acquisition deadline, 4s capture cap, bounded 300ms stop wait, late-launch close ownership, and finally zeroes owned PCM/reference/play buffers. Normal immutable protocol/base64 buffers are transient process memory managed by the existing bridge; no raw audio is persisted or logged. Summary retains only bounded measurements/processing flags and rates/channel counts. Auth, provider and agent-host factories are not called by the real local runner integration test.

Independent engine review corrected phase-decimated correlation and added inverted/off-grid residual, overflow, pending-playback and hung-write cancellation cases (worker `die/review-speaker-measurement-safety-and-va-11d3cd7c`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_c71f40f3-a86675007a5e-task_11d3cd7c`, commit 7b119da).
