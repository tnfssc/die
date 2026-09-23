# Failed Go experiment — removed 2026-09-14

The user called the Go experiment a failure and asked us to commit it, delete it, then commit again.

- Archive commit: ac80ddd (`Archive experimental Go port of die`). It holds the expt-go source, research, validation reports, and old work notes.
- The whole `expt-go/` directory was removed, including ignored local build and test files. No replacement Go app remains in the worktree.
- The original Bun/TypeScript die app did not change. No experiment binary was installed.
- An earlier, user-approved Codex credential import created `~/.godie/auth.json`. This external user state was **not** deleted. The import did not change `~/.die/agent/auth.json`. Project wisdom has no tokens.
- Do not restart or rebuild this experiment unless asked. Old test passes did not prove full real-user parity. Actual use found gaps in first-run auth and slash completion.
