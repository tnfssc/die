# Worktree-backed subagent design — CLI-first constraint

User clarification: Die is a CLI application too. Creating worktrees/spawning isolated subagents MUST NOT require launching T3 Code/web backend. This overrides any implication that all worktree provisioning routes through T3.

Proposed (not implemented) API: subagent({prompt,title?,workspace:{kind:'inherit'|'worktree',baseRef?,branch?}}). Inherit default; each worktree-backed child gets separate worktree. Respect setup policy, durable idempotency, do not erase user work on cancellation.

Architecture constraint: provider-neutral workspace preparation/contract with local Git implementation for CLI; existing already-running T3 backend can coordinate its own thread/worktree/setup lifecycle in web mode. No hidden boot of web service for git operations. Keep launch API consistent without moving CLI task/process ownership into T3. Reuse lightweight existing modules only if they do not drag server runtime/DB into CLI.

Setup config unresolved: T3-only project settings may live in backend DB and cannot be assumed available to CLI. Need inspect actual project/action config locations and establish explicit lightweight CLI-readable setup source (prefer shared repo config if supported) or explicit import/override. Never silently claim CLI ran web-configured setup, auto-start T3 to obtain it, or execute arbitrary setup from untrusted repo without existing trust policy. User requested architectural constraint, no implementation made this turn.

## Scope correction and setup requirement
User says previous investigation/design overscoped. Narrow requested API to subagent({prompt,worktree:true}); default existing shared workspace. No new configuration format/import-export system/approval framework/cleanup UI; sidebar and ongoing parent followup sync separate. User explicitly clarifies CLI worktree creation MUST also run setup in new directory, not only web. CLI still Git+setup directly, no T3 startup. Existing repository t3.json is available portable declaration. UI-only T3 settings are not automatically CLI-accessible; do not pretend same script can be found without a portable source. Need smallest shared convention using existing t3.json and existing trust/setup policy, not turn research recommendations into features. Requirement update only this turn; no code modified.
