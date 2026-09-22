# CLI-first worktree investigation active (2026-09-21)
User authorized investigation, not implementation, after agreeing on workspace options and clarifying CLI MUST NOT boot T3 to create worktrees.
Four scoped read-only research jobs (15min hard, incremental reports):
- task_a471b6f3 config/actions/trust -> wisdom/worktrees/worktree-setup-config-investigation.md
- task_0da515bd CLI lifecycle/cwd/session/cost/memory -> wisdom/worktrees/worktree-cli-lifecycle-investigation.md
- task_131ed780 web launch/preparation/delegation seams -> wisdom/worktrees/worktree-web-integration-investigation.md
- task_4b40a78d Git safety/resource + owned temp git fixtures -> wisdom/worktrees/worktree-git-safety-investigation.md
No builds/shared servers/product edits. Source exact adopted a9b49a7d+canonical patch; old .cache/die-t3code stale. Main synthesis after all reports, verify recommendations against actual code.
Potential API still proposal: subagent({prompt,title?,workspace:{kind:'inherit'|'worktree',baseRef?,branch?}}). Questions to settle: setup file portability vs DB-only project scripts; trust/approval; user-selected config vs repo code; per-child preparatory lifecycle, backend owned thread pause until setup, async script semantics; stable identity batch base commit pin, branch collision/cancel keep-work policy. Sidebar and repeated parent followup sync acknowledged separate later work, not silently included.
Previous followup/worktree workers timed out without reports; lead wrote own source verification wisdom/t3/t3-child-followup-research.md and t3-child-worktree-setup-research.md. Later child direct chat works but initial result transfer only once/task.result stays initial; no claim ongoing parent result sync.

All4reports completed. Main synthesis wisdom/worktrees/worktree-investigation-conclusions.md. No remaining jobs/product edits. Key finding t3.json portable declarations exist but explicit user import/approval; webconfigured actions stored settings.json. CLI Git direct; web factor prep not ordinary ThreadLaunch owner. Next step user decision/implementation authorization, not silently start.
