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

Validation underway at `ef1b283`: full local gate task `task_df836df6`, aggregate `/tmp/die-v0112-local-ci.log`, step logs `artifacts/ci/`. Independent read-only review task `task_404a4fbf`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_404a4fbf`, branch `die/review-v0.11.2-integrated-cleanup-404a4fbf`. Earlier baseline `008fdf4` hosted CI passed in run `36109491516`; that is not proof of these new moves.

Independent review approved `008fdf4..ef1b283` with no blocker. It checked prompt bytes, extracted signal/ACK behavior, identity and bootstrap preservation, env scrub consumers, imports and validated release-note selection. Reviewer worktree lacked full dependencies/compiled CLI; its partial tests do not establish full-gate proof. Parent production build/shared CI remains required. No new general lesson beyond value 3.

Full local shared gate passed on `ef1b283` (task `task_df836df6`, exit 0). Root: 1057 passed, 17 existing opt-in tests skipped, 0 failed. Web: 260 backend, 158 model, 26 contracts, 9 projection tests passed. Format/lint/typecheck, full production web/CLI build, offline transport, standalone smoke passed. Release selector returns `support/release-v0.11.2.md` for `v0.11.2`. Only release wisdom changed after tested code. Ready to push and verify hosted CI/full Release dry run before tagging exact SHA.

Pushed `d13ea625744ad70642991bd5a54c6d5fc30d40c6` to develop. Hosted CI run `36110554541`, Release dry run `36110554528`; both running. Background watchers record `/tmp/die-v0112-hosted-ci.log` and `/tmp/die-v0112-hosted-release.log`. Do not move release SHA for this pending wisdom note: tag tested `d13ea62` after both succeed. No tag/publication yet.

Hosted CI `36110554541` passed both OS lanes. Release dry run `36110554528` failed deterministic tests: ledger eviction test exceeded default 5000 ms; the later path-count check saw one active path. No tag created. Earlier instruction to tag `d13ea62` is superseded: this SHA is not release-verified. Fix worker `task_af528501`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_af528501`, branch `die/fix-release-ledger-test-timeout-af528501`, starts at `d13ea62`. Failure log `/tmp/die-v0112-release-failed.log`. Integrate diagnosed fix, rerun shared local gate, then push and await both hosted gates at the new exact SHA.

Ledger fix reviewed and integrated from `76b2065`. No runtime change or larger timeout. Test setup seeds a valid full ledger instead of doing 261 serial fsynced reservations; actual eviction, reopened replay and capacity checks still use real durable operations, with stronger persisted-content assertions. Parent focused native-routing tests: 15 passed. The unchanged concurrent churn assertion still requires zero active serializer paths. Full local gate and new hosted release proof follow.
