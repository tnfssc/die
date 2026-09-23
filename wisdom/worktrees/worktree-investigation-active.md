# CLI-first worktree investigation active (2026-09-21)

The user approved investigation, not implementation. Workspace options were agreed. The CLI MUST NOT boot T3 to make worktrees.

Four read-only research jobs ran with 15min hard limits and incremental reports:

- task_a471b6f3: config/actions/trust -> wisdom/worktrees/worktree-setup-config-investigation.md
- task_0da515bd: CLI lifecycle/cwd/session/cost/memory -> wisdom/worktrees/worktree-cli-lifecycle-investigation.md
- task_131ed780: web launch/preparation/delegation seams -> wisdom/worktrees/worktree-web-integration-investigation.md
- task_4b40a78d: Git safety/resources and owned temporary Git fixtures -> wisdom/worktrees/worktree-git-safety-investigation.md

No builds, shared servers, or product edits. The exact adopted source was a9b49a7d plus the canonical patch. Old .cache/die-t3code was stale. Main would combine the reports and check their advice against the code.

The API was still only a proposal: subagent({prompt,title?,workspace:{kind:'inherit'|'worktree',baseRef?,branch?}}). Open questions were setup-file portability versus DB-only project scripts, trust and approval, user-selected config versus repo code, each child's preparation lifecycle, keeping the backend-owned thread paused until setup, async script rules, one stable base commit for a batch, branch collisions, and whether cancellation keeps work. Sidebar work and repeated parent follow-up sync were separate later work, not hidden parts of this change.

Earlier follow-up/worktree workers timed out without reports. The lead wrote its own source checks in wisdom/t3/t3-child-followup-research.md and t3-child-worktree-setup-research.md. Direct chat with a child worked later. But the first result crossed back only once. task.result stayed on that first result. There was no claim of ongoing parent-result sync.

All four reports finished. Main combined them in wisdom/worktrees/worktree-investigation-conclusions.md. No jobs or product edits were left. The key finding was that t3.json has portable declarations. But CLI use needed explicit user import and approval. Web-configured actions lived in settings.json. The CLI should use Git directly. Web should factor out preparation instead of making ordinary ThreadLaunch the owner. Next step was a user decision and implementation approval. Work was not to start silently.
