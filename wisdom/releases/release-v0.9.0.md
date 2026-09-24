# Stable v0.9.0: session voice orchestration and explicit native processing

Release workspace: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d44fa40b; branch die/integrate-and-release-voice-jobs-and-ech-d44fa40b. Review workspace: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d44fa40b-a86675007a5e-task_e52463ee; branch die/review-combined-voice-integration-e52463ee. Independent review of combined bebcd22 found no concrete integration failure; no edits.

User authorized normal stable publication and develop integration. Remote latest was v0.8.2; v0.9.0 was absent. Minor version reflects new voice-to-current-session agent/jobs functionality. Includes bridge ce790a6 and review fixes d34158c, 6451b38, 905cb8a, plus echo 4221296 cherry-picked as bebcd22. Echo commit already contains 4bff0ab research verbatim; no duplicate cherry-pick. origin/develop 7db8b85 is an ancestor.

Read values, feature orchestration/research, and release verification preference. Existing values cover truthful evidence, bounded authority, and packaged-artifact checks; values unchanged.

Local focused gate: 54 tests, 272 assertions pass (seven bridge/extension/orchestration/tools/job-service/native-routing files), typecheck, format and lint pass (existing warnings/info). First attempt omitted prepare:assets and failed importing photon WASM; prepared assets and reran successfully. No full local release matrix: use existing tag-triggered workflow once, including native Mac compilation, ASan/UBSan, protocol/self-test, full deterministic/build/web/PTY checks, actual Mac embedded helper and old-updater verification before publishing. No devices, paid APIs, secret reads, or real user-job cancels. Local logs under /tmp are ephemeral, not durable evidence.

Exact trimmed completed transcription is required, not semantic transcript matching or speaker authentication. Missing completion markers/paraphrases/expired turns fail closed. Polling observes bounded scoped snapshots (first 20 and known active), not exhaustive native events. No real conversation proof. Echo explicitly sets bypass=false and verifies ready diagnostics, retaining v0.8.2 graph; AEC/double-talk and physical Ghostty startup remain unverified. See wisdom/live/live-lab-orchestration.md and wisdom/live/macos-speaker-echo-research.md.

Publication evidence pending. After successful tag gates, record release URL, assets/latest stable and CI proof, then ordinary fast-forward develop with documentation-only skip-ci to avoid duplicate full release matrix. Never force-push or replace tags.
