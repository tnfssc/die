# Subagent workspaces

Subagents use the parent's workspace unless you ask for a separate one. Use a Git
worktree when a child needs its own code or PR:

```ts
await subagent({
  prompt: "Implement the parser change and test it",
  title: "Parser change",
  workspace: { kind: "worktree" },
});
```

`workspace` accepts `{ kind: "inherit" }` or
`{ kind: "worktree", baseRef?, branch? }`. `title` gives the task or thread a
readable name. Worktrees need a Git repository. By default, each starts from the
parent's current commit. Use `baseRef` to pick another local commit or ref. Leave
out branch to get a unique readable name. An explicit branch must be new. Die
never resets an existing branch.

A `prompts: string[]` batch makes one worktree per child. All children start from
one pinned commit. A batch cannot use an explicit branch. Make separate calls if
you need named branches. Parent changes that are dirty, untracked, ignored, or
secret do not go into the child worktree.

One local setup failure does not cancel the other children. A native batch
transport failure reports the IDs that already launched. Those children stay
owned. So you can inspect or cancel them.

## Setup

The CLI uses Git itself. It does not start T3 or read the T3 database. It reads the
repository's `t3.json` and uses the first script with
`runOnWorktreeCreate: true`. Web delegation uses the setup action already set for
the project. The CLI does not silently import a web-only action.

Setup runs inside the new worktree. With `async: false`, the child starts only
after setup succeeds. If async is omitted or true, the current background rule
still applies. No setup declaration means no setup script. The CLI runs declared
setup on its own. It does not ask for confirmation, project trust, or approval.
Project trust still controls the child agent's trust mode, not setup.

## Ownership and retention

Local children keep the usual task and session ancestry, cost totals, profiles,
custom instructions, waits, and timeouts. Web delegation is still async-only. Omit
`waitSeconds` or use zero. Web delegation does not support runtime deadlines.
Use `jobs.inspect` to inspect a child and `jobs.stop` to stop its owned work.

You can inspect a local worktree job while it prepares, before its provider starts.
Its timeout includes preparation. Inspection shows the workspace identity and
path, plus preparation and setup state. After a server restart, an unclear native
preparation result is reported as uncertain. Die does not guess by running it
again.

Worktrees and branches stay after success, failure, or cancellation. This leaves
them ready for review, a PR, or follow-up work. Die does not clean them up, copy
secrets, create PRs, move sidebar items, or keep syncing a parent's result after
direct follow-up in the child.

Validation covers Linux x64 in ordinary, non-bare Git checkouts. It does not claim
cross-platform cancellation or ready submodules. CLI jobs do not recover through
a process crash with the current in-session task API. Kept worktrees are not
reused automatically, and setup is not run again.

See [the native delegation status](../t3/t3-v2-delegation-status.md) for validation,
platform details, and remaining limits.
