# v0.14.0 release work

User approved push and new release after model work and review.
Candidate adds selected-agent GPT-Live, Gemini Extended Thinking, and
normal-color task attention. Public scope and limits: support/release-v0.14.0.md.

Integration merge f519798 combines GPT tip acae36b and Gemini work.
Config conflict preserves googleModel and removes obsolete GPT guards.
Provider switch memory includes GPT-Live and both Gemini models.
Both conflicting model tests are retained. Parent typecheck passed.
Combined review job task_2e733e5c uses durable worktree
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_2e733e5c
branch die/review-combined-live-release-integration-2e733e5c.

Whole gate is next. No candidate push, tag or publication yet.
Use Bun 1.4.2, Node 24.21.0, pnpm 11.27.1 from mise install bins,
SHELL=/bin/sh, and bun run ci. Do not trust unrelated worktree mise files.
After passing local gate and review, push develop and watch CI plus release
dry run at exact SHA. Tag v0.14.0 only at that passing SHA. Verify release
metadata and assets; do not redownload binaries merely to repeat hashes.

Canonical Google/OpenAI voice keys missing. Bounded probes were approved
but cannot run with missing keys. Codex OAuth is not an OpenAI voice key.
No paid/device claim.

Wisdom updated for feature architecture, reviews, handoff and release.
Values unchanged: one task authority can have a paired voice frontend.
Existing whole-path proof and honest evidence cover this architecture.

Independent review found a real prompt-option restore bug after paired
voice stops without a coding turn. Fix e9dd7c3 is reviewed but not yet
integrated: first gate task_5576d189 is still running on the prior source.
Let it finish, cherry-pick e9dd7c3, then rerun frozen final gate.
Reviewer reports 120 focused + 17 paired tests pass and typecheck pass.

First complete gate passed: 1121 tests, 17 opt-in skips, no failures;
web/build/smoke gates passed too. Review fix now integrated as 9ba3e5a.
Final frozen candidate gate will rerun before pushing.
