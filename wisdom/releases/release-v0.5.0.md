# v0.5.0

- Add native T3 child delegation. The backend owns threads, transcripts, cancellation, and completion delivery.
- Let CLI and web subagents use their own optional Git worktrees. CLI setup works without starting the web server. Batch launches pin a common base, and branches/worktrees remain for review.
- Use the last model picked by the user for new web sessions.
- Add regression tests for task ownership, terminal streams, native routing, worktree setup, and model selection.

## Important behavior

CLI worktree setup automatically executes the repository’s configured `t3.json` worktree-create action without a confirmation or trust gate. It does not copy dirty parent files, ignored files, or secrets. Native web delegation is asynchronous and does not accept runtime deadlines. Worktrees stay until someone removes them.

See [subagent workspaces](https://github.com/tnfssc/die/blob/v0.5.0/wisdom/worktrees/subagent-workspaces.md) and [native delegation status](https://github.com/tnfssc/die/blob/v0.5.0/wisdom/t3/t3-v2-delegation-status.md) for API details and limitations. Worktree runtime checks cover normal Linux x64 Git checkouts. They do not prove cancellation on other platforms or that submodules are ready.

Release assets include Linux x64, Linux ARM64, macOS ARM64, and Android ARM64 binaries, SHA-256 checksums, source identity, and license notices. This publication does not install anything locally.
