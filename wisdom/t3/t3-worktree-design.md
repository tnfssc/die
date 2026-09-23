# Worktree-backed subagent design — CLI-first constraint

Die is also a CLI app. Creating worktrees or isolated subagents MUST NOT need the T3 Code/web backend. Do not route all worktree setup through T3.

Proposed API, not built: subagent({prompt,title?,workspace:{kind:'inherit'|'worktree',baseRef?,branch?}}). Default to inherit. Give each worktree-backed child its own worktree. Follow setup policy and durable idempotency. Do not erase user work on cancellation.

Keep workspace setup provider-neutral. The CLI uses local Git. In web mode, an already-running T3 backend can manage its own thread, worktree, and setup lifecycle. Do not secretly start the web service for Git work. Keep one launch API. Do not give T3 ownership of CLI tasks or processes. Reuse small existing modules only when they do not pull the server runtime or DB into the CLI.

Setup config was unresolved. T3-only project settings may live in the backend DB, outside the CLI. Inspect the real project and action config locations. Then choose a small setup source the CLI can read. Prefer shared repo config when supported; otherwise use an explicit import or override. Never claim the CLI ran web-configured setup when it did not. Do not start T3 to fetch setup. Keep the existing trust policy before running setup from an untrusted repo. This turn set only the design constraint. It changed no code.

## Scope correction and setup requirement
The earlier design was too broad. Narrow the API to subagent({prompt,worktree:true}). Keep the existing shared workspace as the default. Do not add a config format, import/export system, approval framework, or cleanup UI. Sidebar work and ongoing parent follow-up sync are separate. CLI worktree creation MUST also run setup in the new directory, not only on the web. The CLI still runs Git and setup itself. It does not start T3. The repo's existing t3.json is the portable declaration. The CLI cannot read UI-only T3 settings by default. Do not pretend it can find the same script without a portable source. Use the smallest shared convention that works with the existing t3.json and trust/setup policy. Do not turn research ideas into features. This turn only updated the requirement. It changed no code.
