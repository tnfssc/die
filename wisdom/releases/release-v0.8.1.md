# v0.8.1 diagnostic stable patch

Release owner worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_657b35ea` (branch `die/publish-mac-audio-startup-diagnostics-pa-657b35ea`). Diagnostic source: `722823e43f29ca031cf61c734fc8037f76e8b4cb`. Review worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_657b35ea-a86675007a5e-task_bc849f8b`, branch `die/review-mic-diagnostics-safety-bc849f8b`.

User uses Ghostty, saw no microphone prompt, and prior SoX capture worked. Root cause remains unknown; this is a diagnostic patch, not a verified root-cause fix. See [diagnostic details](../live/live-lab-mac-startup-diagnostics.md). Known stage codes stay allowlisted; arbitrary helper errors/messages are never surfaced. Mic check requires explicit consent, discards buffers and does not use credentials/providers.

Local focused tests: 43 passed across seven live-lab files; format, lint and typecheck passed (existing lint warnings). No devices or provider calls. Linux cannot validate Swift/AVFoundation: tag Release workflow is the required Mac compiler/native/embedded-helper gate before publication. Avoid duplicate pretag full matrix: publish via tag gates, then safely fast-forward develop with release-proof documentation using skip-ci. Fetch/recheck upstream before integration; no force push or tag replacement.

Values unchanged: truthful evidence, consent, safe preservation, and small design already cover this follow-up. Publication proof to be appended after the workflow finishes.
