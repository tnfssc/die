# Stable OpenAI voice release v0.10.0

Release branch: die/release-three-openai-voice-providers-38da9ddd. Durable worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_38da9ddd.

Requested implementation e324ce7 and final review task_e2cf1dc7 (155 focused tests, typecheck, source+compiled GPT-Live loopback passed; no blockers). Fetched origin before preparation: develop 44ff46f and stable v0.9.2 are already ancestors of implementation; user Mac commits preserved without rebasing or replacement. Remote latest stable was v0.9.2; next feature release is v0.10.0.

Read values and Live provider implementation/research notes. Exact selector includes gpt-realtime-2.1, gpt-realtime-2.1-mini, gpt-live-1; Gemini remains default and selection persists. Canonical /login API-key setup and die update syntax independently audited by task_436e5562, branch die/verify-release-setup-and-selector-436e5562, worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_38da9ddd-a86675007a5e-task_436e5562. No code edits from reviewer. Provider entitlement and physical-device behavior remain explicitly untested, not silently claimed as proven.

Preflight found formatting-only failure in tests/live-playback.test.ts; applied Biome formatting, then 21 scheduler tests passed (20,124 assertions), full format check and tag/version validation passed. No behavior change. Use one existing tag-triggered Release run; do not duplicate full matrices before tag. Publication is gated on deterministic tests, native Mac sanitizers/helper, embedded release helper, Linux/Mac updater, web and attribution checks. No paid calls/devices/secrets/local installation, force pushes or tag overwrite.

Release notes explicitly document GPT-Live RMS heuristic and possible stale tails, API billing (not Codex OAuth), and API/device evidence limits. Values reviewed: unchanged; existing honest evidence, preservation, authority and efficient built-path verification principles cover this release. Publication evidence to follow.
