# Current user questions — read-only research
The user asks two questions. How do separate child chats and inspection work? Does 'spawn five subagents [in separate worktrees]' run T3 project setup or actions? This is not an implementation request yet.

Workers task_013032b8 and task_68bc79f3 researched child follow-up and worktree setup. Both were read-only. Their reports are wisdom/t3/t3-child-followup-research.md and wisdom/t3/t3-child-worktree-setup-research.md.

The lead verified the source. DieTaskService calls delegateTask asynchronously. makeSubagentChildThread creates the child by spreading the parent. So it inherits branch and worktreePath. It does not use ThreadLaunchService. The real new-worktree path in ThreadLaunchService creates a Git worktree and calls ProjectSetupScriptRunner.runForThread. That runner uses the configured setupProjectScript, and its async policy decides whether to wait.

So a native subagent creates no worktree and runs no new-worktree setup action. It inherits the parent worktree. Freeform prompt text does not add a structured workspace argument. The lead still needed the detailed child follow-up and latest parent-result behavior before giving a firm answer about ongoing sync. Canonical source: .cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e. Product code did not change in this turn.

The workers timed out without notes. The lead finished the direct source review and wrote both reports. No jobs stay. One more gap matters: initial delegated result transfer happens once. Later direct child follow-ups use normal chat. But parent inspection can still prefer the first task.result. Do not promise continuous parent conversation or result sync.
