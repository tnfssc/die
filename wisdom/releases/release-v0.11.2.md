# v0.11.2 code placement cleanup

User asked to do the audited file/code moves, push, and make a release. Main integration workspace `/home/tnfssc/Code/die`, branch `develop`, started at `008fdf4`. Next patch is `0.11.2`; latest published was `v0.11.1`. No tag yet.

Workers start at `008fdf4`:
- Prompts/config: `task_e23fad3b`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_e23fad3b`, branch `die/consolidate-prompts-and-metadata-e23fad3b`.
- Shared runtime: `task_15754783`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_15754783`, branch `die/move-shared-runtime-contracts-to-clear-o-15754783`.
- Web packaging: `task_471cff38`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_471cff38`, branch `die/consolidate-web-packaging-ownership-471cff38`.

Main owns version/notes, integration, full CI, review, push/tag/publication. Scope is the [placement audit](../quality/code-placement-audit.md), with behavior unchanged. Keep protocol-specific prompts and trust boundaries distinct. Candidate packaging needs investigation before any merge/removal.

Plan: review worker diffs, integrate, run `mise exec node@24.21.0 npm:pnpm@11.27.1 -- bun run ci` with Bun 1.4.2; push develop; wait for both CI and full Release dry run at the exact SHA; tag that tested SHA and let the tag workflow reuse verified assets. Check final release and assets exist. No unnecessary published binary downloads. See [release verification preference](release-verification-preference.md). No live API/device calls authorized by this cleanup.

Wisdom/values review after integration and release. Value 3 was already clarified during audit: shared rules belong with their real owner, not a second copy.

## Integrated

Workers landed as `4371a9e` (prompts), `7b8859e` (runtime), `488c191` (packaging). Parent reviewed diffs and callers. Candidate builder stays separate: it is a non-adopted research tool, not a production path worth giving a new shared abstraction. Worker-focused proof is in feature wisdom. Runtime worker used a placeholder archive for local execute checks; only the parent full production build/gate may establish packaging proof.

Next: independent combined review and full local gate before push. No provider/device calls.
