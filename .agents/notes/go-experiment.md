# Failed Go experiment — removed 2026-09-14

User declared the Go experiment failed and requested: commit, delete, commit again.

- Archive commit: ac80ddd (`Archive experimental Go port of die`). Contains the expt-go source, research, validation reports, and historical work notes.
- Removed the entire `expt-go/` directory, including ignored local build/test artifacts. No replacement Go app remains in the worktree.
- The original Bun/TypeScript die app is unchanged. No experiment binary was installed.
- User-authorized Codex credential import previously created `~/.godie/auth.json`; this external user state was **not** deleted. Source `~/.die/agent/auth.json` was not altered by import. No tokens in project memory.
- Do not resume/rebuild this experiment unless requested. Historical test passes did not establish complete real-user parity; first-run auth and slash completion gaps surfaced in actual use.
