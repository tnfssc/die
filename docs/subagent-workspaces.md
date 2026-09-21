# Subagent workspaces

Subagents share the parent's workspace by default. Request a separate Git worktree
for independent code or PR work:

```ts
await subagent({
  prompt: "Implement the parser change and test it",
  title: "Parser change",
  workspace: { kind: "worktree" },
});
```

`workspace` accepts `{ kind: "inherit" }` or
`{ kind: "worktree", baseRef?, branch? }`. `title` is a readable task/thread name.
A worktree needs a Git repository. The default base is the parent's current commit;
`baseRef` can select another local commit/ref. An omitted branch gets a unique
readable name. An explicit branch must be new: existing branches are never reset.

A `prompts: string[]` batch creates one independent worktree per child from one
pinned base commit. An explicit branch is rejected for a multi-prompt batch; use
individual calls to name separate branches. Dirty tracked files, untracked files,
ignored files and secrets are not copied from the parent's checkout. Local worktree preparation
failures return failed child jobs without cancelling siblings. A native batch
transport failure reports already-launched IDs; those siblings remain owned and
can be inspected or cancelled.

## Setup

CLI preparation uses Git directly, without starting T3 or reading its database.
It reads the existing repository `t3.json` setup declaration: the first script
with `runOnWorktreeCreate: true`. Web delegation uses the project's existing
configured setup action instead. A web-only action is not silently imported into
the CLI.

Setup runs in the new worktree. `async: false` waits for successful setup before
the child starts; omitted/true keeps the existing background policy. No configured
setup means no setup script. CLI setup executes automatically when declared, with no confirmation, project-trust,
or approval gate. Project trust still controls the child agent's own trust mode;
it does not control setup execution.

## Ownership and retention

Local children retain the existing task/session ancestry, cost aggregation,
profiles, custom instructions, wait and timeout behavior. Configured web delegation
remains async-only: omit `waitSeconds` or use zero; runtime deadlines are not
supported there. Use `jobs.inspect` to inspect a child and `jobs.stop` to cancel
its owned work. Local worktree jobs are inspectable while preparing, before the
provider starts; their timeout includes preparation. Inspection includes the
workspace identity/path and preparation/setup state. Native preparation whose
outcome is uncertain after a server restart is reported as uncertain, not blindly
rerun.

Worktrees and branches remain after success, failure or cancellation, for review,
PR creation or follow-up. Die does not automatically clean them up, copy secrets,
create PRs, reorganize the sidebar or continuously resynchronize a parent's result
after direct child follow-up.

Validation currently covers Linux x64 in ordinary (non-bare) Git checkouts.
Cross-platform cancellation and submodule readiness are not claimed. CLI job
recovery after a process crash remains outside the existing in-session task API;
retained worktrees are not automatically reused or setup rerun.

Validation/platform details and any remaining restrictions are recorded in
[the native delegation status](t3-v2-delegation-status.md).
