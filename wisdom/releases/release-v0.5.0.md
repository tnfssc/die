# v0.5.0

- Native T3 child delegation with backend-owned threads, transcripts, cancellation, and completion delivery.
- Optional independent Git worktrees for subagents in CLI and web; CLI preparation works without starting the web server. Batch launches pin a common base, and branches/worktrees remain for review.
- Retain the last explicitly selected model for new web sessions.
- Regression coverage for task ownership, terminal streams, native routing, worktree preparation, and model selection.

## Important behavior

CLI worktree setup automatically executes the repository’s configured `t3.json` worktree-create action without a confirmation or trust gate. Parent dirty files, ignored files, and secrets are not copied. Native web delegation is asynchronous and does not accept runtime deadlines. Worktrees are not automatically removed.

See [subagent workspaces](https://github.com/tnfssc/die/blob/v0.5.0/wisdom/worktrees/subagent-workspaces.md) and [native delegation status](https://github.com/tnfssc/die/blob/v0.5.0/wisdom/t3/t3-v2-delegation-status.md) for API details and limitations. Worktree runtime validation targets Linux x64 ordinary Git checkouts; cross-platform cancellation and submodule readiness are not claimed.

Release assets include Linux x64, Linux ARM64, macOS ARM64, and Android ARM64 binaries, SHA-256 checksums, source identity, and license notices. No local installation is performed as part of this publication.
