# Worktree-backed subagent design — CLI-first constraint

Die is also a CLI app. Creating worktrees or isolated subagents MUST NOT need the T3 Code/web backend. Do not route all worktree setup through T3.

Proposed API, not built: subagent({prompt,title?,workspace:{kind:'inherit'|'worktree',baseRef?,branch?}}). The default is inherit. Give each worktree-backed child its own worktree. Follow setup policy and durable idempotency. Do not erase user work on cancellation.

Keep workspace setup provider-neutral. The CLI uses local Git. An already-running T3 backend can manage its own thread, worktree, and setup lifecycle in web mode. Do not secretly start the web service for Git work. Keep the launch API the same without giving T3 ownership of CLI tasks or processes. Reuse small existing modules only when they do not pull the server runtime or DB into the CLI.

Setup config was unresolved. T3-only project settings may live in the backend DB, so the CLI may not have them. Inspect the real project and action config locations. Then choose a small CLI-readable setup source, preferably shared repo config if supported, or an explicit import or override. Never claim the CLI ran web-configured setup when it did not. Do not start T3 to fetch that setup. Do not run arbitrary setup from an untrusted repo without the existing trust policy. This turn only set the design constraint. It changed no code.

## Scope correction and setup requirement
The earlier design was too broad. Narrow the API to subagent({prompt,worktree:true}). Keep the existing shared workspace as the default. Do not add a config format, import/export system, approval framework, or cleanup UI. Sidebar work and ongoing parent follow-up sync are separate. CLI worktree creation MUST also run setup in the new directory, not only on the web. The CLI still runs Git and setup itself. It does not start T3. The repo's existing t3.json is the portable declaration. The CLI cannot read UI-only T3 settings by default. Do not pretend it can find the same script without a portable source. Use the smallest shared convention that works with the existing t3.json and trust/setup policy. Do not turn research ideas into features. This turn only updated the requirement. It changed no code.
