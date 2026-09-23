# Worktree setup/config investigation

_Investigation started. Findings below were updated as the work moved._

## Scope and constraints
- Investigation only. No product changes, builds, installs, or server startup.
- Adopted immutable T3 pin: `.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e`.
- Questions: storage/schema/API/precedence/runtime semantics. CLI portability. Trust boundaries.

## Verified source basis
- Inspected the requested cache, whose Git HEAD is exactly `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`. Its working tree contains the adopted Die/T3 patch. But none of the setup/action files cited below appeared in the modified-file sample. Evidence is from the exact adopted tree, not stale `.cache/die-t3code`.
- Also inspected current Die root and installed `@earendil-works/pi-coding-agent@0.85.1` docs/source. No services were started and no scripts/builds were run.

## Existing workspace launch boundaries (verified)
- Adopted T3 already has `t3_thread_launch` for an **ordinary top-level T3 thread**, explicitly not a delegated Die child. Its workspace strategy is `root`, `existing_worktree`, or new `worktree {baseRef,branch?,startFromOrigin?}` (`packages/contracts/src/orchestrationV2.ts:2711`, `mcp/toolkits/project/tools.ts:88`). That server-owned path is what calls `ThreadLaunchService` and T3 setup actions. It is evidence to compare against, not a CLI implementation to reuse wholesale.
- The adopted native Die delegation bridge is still async-only: native omitted/zero wait returns background, positive waits and native timeout/input/watch/snooze reject, per `wisdom/t3/t3-v2-delegation-status.md`. Current local CLI delegation retains its own wait/job lifecycle. Adding local `subagent.workspace` must not route through `t3_thread_launch` or change that ownership boundary.

## Existing T3 support (verified)

### There is already an official repository-local convention
- `packages/contracts/src/t3ProjectFile.ts` defines repository-root `t3.json` and publishes its schema at `https://t3.codes/schema/t3.json`. Parsing is lenient JSON/JSONC (comments/trailing commas are tested) through `packages/shared/src/t3ProjectFile.ts`.
- Schema: optional `$schema`, `iconPath`, `defaultThreadEnvMode: "worktree" | "local"`, and at most 50 `scripts`. Each file script has required trimmed `name` and `command`, and optional `icon`, `runOnWorktreeCreate`, `async`, `previewUrl`, `autoOpenPreview`. File scripts intentionally have no persisted action ID.
- `async` only matters for a setup script: true/default means start the agent while setup continues. False means hold agent startup until exit.
- `apps/server/src/project/T3ProjectFileLoader.ts` reads exactly `<workspaceRoot>/t3.json`, returns absent on missing/unreadable/invalid and logs invalid/read errors. Tests verify JSONC and whole-file rejection for malformed/schema-invalid data.
- The web independently reads the file through the project-file query API and parses it client-side: `apps/web/src/hooks/useT3ProjectFileScripts.ts`. Missing/truncated/invalid means no scripts. UI distinguishes invalid for warning.

### Checked-in scripts are declarations, not automatic execution
- `ProjectActionsSettings.tsx` labels these **Import from t3.json**. Import is a user click, excludes duplicates by command or case-insensitive name, supplies defaults (icon play, setup false, async true), generates/deduplicates a local ID, then saves a normal project action.
- Therefore merely checking in `t3.json` does **not** make T3 execute its command. This is an important existing trust/consent property.
- `defaultThreadEnvMode` is different: it is read as a default without import. Precedence is explicit composer choice, then per-project setting, then `t3.json`, then global default (`packages/shared/src/threadEnvMode.ts`).

### Where imported/configured actions are stored
- Canonical current storage is the environment's local `<stateDir>/settings.json`, not the repository and not SQLite: `apps/server/src/config.ts:145`; `ServerSettings.projectSettingsOverrides[projectId].defaultProjectScripts` for project override, or `defaultProjectScripts` for machine/environment default.
- Web save path: `useProjectScriptSettings.ts` calls the typed WebSocket RPC `server.updateSettings` with a `ServerSettingsPatch`. Contract is `packages/contracts/src/rpc.ts:652`, handler `apps/server/src/ws.ts:2388`. Project override entries are whole-entry replacement. Null removes an entry. Saves are atomic in `serverSettings.ts`.
- SQLite `projection_projects.scripts_json` is legacy/project-aggregate storage. On a trusted settings-file load, server startup folds live project model/thread-env/auto-pull/scripts columns into `projectSettingsOverrides`, writes settings.json, and sets `projectSettingsFolded`. After the fold, resolution ignores aggregate scripts. Evidence: `serverSettings.ts:675-760`, `packages/shared/src/projectScripts.ts`.
- Resolution order during the compatibility window: canonical project override. If folded, machine defaults. Otherwise legacy override map (null means machine default), then project aggregate scripts if nonempty, then machine default. There is no merge: selected list replaces the lower source.

### Persisted action schema and setup/action distinction
- Persisted `ProjectScript` (`packages/contracts/src/project.ts`): `id,name,command,icon,runOnWorktreeCreate`. Optional `async,previewUrl,autoOpenPreview`.
- All are actions runnable manually in a terminal. Exactly the **first** resolved action with `runOnWorktreeCreate` is the setup action (`setupProjectScript` uses `find`). UI makes a newly selected setup action clear that flag on the others. A regular action is not setup. Preview/keybinding fields are UI behavior, not workspace preparation.

### Execution semantics
- `ProjectSetupScriptRunner.ts` resolves project, reads server settings, selects the first setup action, and opens a managed PTY with cwd equal to the new worktree (or passed checkout path). Environment inherits the terminal/process environment plus `T3CODE_PROJECT_ROOT=<main workspace>`, `T3CODE_WORKTREE_PATH=<new worktree>`, `COLORTERM=""`, `NO_COLOR=1`, `FORCE_COLOR=0`.
- It writes the configured command to the user's platform shell. When completion observation is requested it wraps the command with a random-token sentinel, subscribes before write, reports cleaned bounded output lines, duration and exit code. No timeout is visible in this runner.
- Normal new-thread bootstrap invokes the selected setup action for both worktree and local workspace strategies (despite the field name `runOnWorktreeCreate`) and observes completion. `async !== false`: release/start agent immediately. But bootstrap is still alive tracking setup and ultimately marks the card done/failed. `async === false`: wait. Nonzero/null exit fails prepared startup and agent is not released. No script marks stage skipped.
- MCP worktree handoff defaults `runSetupScript` to true. It does **not** observe or wait, regardless of action `async`. It returns `started` as soon as terminal launch/write succeeds. Runner defects are reported as setup failed but handoff is still committed. This differs materially from new-thread bootstrap.
- PR worktree preparation also invokes the runner and catches/logs launch failure. Existing-worktree branches in that path can invoke it again. I found no durable per-worktree setup receipt/idempotency key and no automatic retry policy. New-thread launch has a process-level command reservation/replay mechanism. But it is not a general once-per-worktree setup record. Treat “exactly once” and retry-after-crash as **not supported/unknown**, not implied.
- Cancellation in tracked new-thread bootstrap can close the known setup terminal and remove a newly created worktree before the launch is marked uncancellable. No evidence that this makes arbitrary setup side effects transactional.


## Standalone Die/Pi trust boundary (verified)
- Die uses Pi `@earendil-works/pi-coding-agent@0.85.1`. Pi docs `docs/security.md` and `docs/settings.md` say project trust gates `.pi/settings.json`, project extensions/skills/prompts/themes/system prompts, missing project packages, and project package-managed extensions. Extensions are executable TypeScript with the user's permissions. Trust is an input-loading guard, not a sandbox.
- Decisions are in `~/.pi/agent/trust.json`, keyed by canonical directory. Closest decision on current/ancestor path wins. Interactive default is ask. Noninteractive `-p`/JSON/RPC never prompts: saved decision applies, otherwise global `defaultProjectTrust`. Default `ask` and `never` skip project resources, `always` loads them. `--approve/-a` and `--no-approve/-na` are one-run overrides. `/trust` persists but requires restart to affect the current session.
- Context files (AGENTS.md/CLAUDE.md etc.) are loaded regardless of project trust unless context loading is disabled. This is distinct from executable extension/package approval.
- Current local subagent launch in `src/tasks/job-service.ts` starts the child with the parent cwd, `--mode json -p`, and no `--approve`/`--no-approve`. Thus it relies on Pi's saved/global noninteractive resolution. It does not explicitly inherit the live parent's resolved trust decision. Die's own built-in extension factories are CLI-owned, not repository-local.
- A worktree at another canonical path will not automatically match a trust entry for the original checkout unless an ancestor entry happens to cover both. Git common repository identity is not part of Pi's documented trust lookup. Therefore “source checkout was trusted” cannot now be claimed to trust a newly created worktree.
- T3 has no comparable project-source trust gate in the setup runner. Its safety property is indirect: checked-in `t3.json` scripts are import-only, while executable actions were explicitly imported/entered into machine `settings.json`. T3 action execution does not consult Pi trust. Worktree creation alone executes git, not the repository script. Setup execution is a separate capability.

## Can CLI consume the same configuration without T3?
**Yes for the repo declaration, no for the currently imported effective T3 setting.**

- A standalone CLI can read `<git-workspace-root>/t3.json` directly without booting T3, SQLite, WebSocket, or server. This is the official portable file.
- It cannot discover T3's effective imported action by reading the repo: that choice/edited command lives in T3's per-environment `~/.t3/{userdata|dev}/settings.json` (or custom `T3CODE_HOME/base-dir`) and is keyed by T3 ProjectId. Resolution also includes a one-time SQLite migration. Coupling Die to this would require duplicating T3 identity/migration/precedence and risks races with T3 atomic writes. Do not do it and do not silently start T3.
- Do not import T3's exact `parseT3ProjectFile` package just for this file. It would also pull `effect`, contracts, and shared code. The grammar is small enough for a standalone reader. Exact compatibility still matters: strip JSONC, trim values, ignore unknown object fields at runtime even though the editor schema is closed, and enforce the icon enum and size limits. Die currently has no JSONC parser. A tiny isolated reader can implement only this subset and use fixtures shared or copied from the published schema. That is less coupling than server or DB access, but it remains compatibility code and needs tests.
- There is an official **import** UI from `t3.json`. Targeted searches found no action export/write-to-`t3.json` UI or CLI. The generic project-file API can read/write files. But that is not an established action-export convention. Mark export as absent, not inferred.

## Recommendation (proposal, not existing support)
1. **Do not invent another repo setup format initially.** Reuse the official `t3.json` script subset as the portable declaration. Select at most one entry with `runOnWorktreeCreate: true`. Reject ambiguity instead of silently depending on array order (T3 currently takes first).
2. **Do not execute it merely because it exists.** Add an explicit workspace setup policy to the launch contract, separate from `workspace.kind`, e.g. `setup: { source: "t3.json", approval: <explicit token/flag> }` or a prior CLI user-local approval keyed by canonical repository identity + setup command digest. Default is no setup. Never treat `workspace.kind:"worktree"`, Pi context-file loading, or a T3 default as approval.
3. If product requirements demand web-edited setup to be immediately CLI-visible, web must explicitly **export/save the portable declaration to `t3.json`** (with review and repository write), then both web and CLI read that file. Web may continue importing it into machine settings for T3 runtime. It must not expose server `settings.json` as a hidden cross-runtime dependency.
4. If writing the repo is undesirable, the smallest alternative is a Die-owned user-local approval/config (not portable across users), keyed by stable repository identity and containing the complete command + wait policy + digest. Web could call a tiny Die-owned file API/CLI to manage it. But then it is not a team-portable repository convention. Prefer explicitness over pretending T3's local setting is shared.

### Proposed API/runtime invariants
- Workspace preparation is provider-neutral and local. CLI never boots T3 and never reads T3 SQLite/server settings.
- Worktree creation and setup execution are separate states/capabilities. Worktree success must be reportable even when setup is absent/denied/failed.
- Resolve config from the original trusted source checkout before creation, record exact command/config digest, and execute in the created worktree cwd. Re-read-before-exec only if digest is revalidated. Avoid TOCTOU ambiguity.
- Explicit env contract only: inherit parent environment unless documented, add stable original-root/worktree variables. T3 names may be mirrored for compatibility but should not be the sole generic contract.
- Wait semantics are explicit in launch result: `wait:false` means child may start after command spawn; `wait:true` means zero exit before child start. Spawn failure and waited nonzero are failures. Background nonzero is an asynchronous workspace/setup event and must not retroactively claim child never started.
- Define at-most-once by durable workspace/setup operation ID and persisted terminal outcome. Do not automatically retry an arbitrary command after timeout/crash. A user must explicitly retry. Retrying uses a new attempt ID and preserves prior output/status.
- Cancellation never removes a worktree with user changes and never claims rollback of script side effects. Cleanup requires ownership + clean-state checks.
- Approval is tied to source repository identity and command/config digest. Changing `t3.json` invalidates it. Decide explicitly whether approval transfers to worktree paths. Pi's path trust is still separate and should be passed deliberately to child startup (deny by default in noninteractive mode unless repository approval policy explicitly maps it).
- Schema errors, multiple setup declarations, and absent files are surfaced distinctly. No fallback to T3 local settings.

## Minimal validation experiments (not run; implementation was unauthorized)
1. Parser contract fixtures: valid strict JSON, comments/trailing commas, strings containing comment/comma tokens, whitespace trimming, unknown keys, invalid icons, >50 scripts, two setup flags. Compare lightweight reader to pinned T3 decoder on fixtures only.
2. Trust matrix in temp HOME: source path saved trusted/untrusted, worktree outside source ancestry, noninteractive default ask/never/always, explicit approve/no-approve. Assert whether project extension loads. Assert setup still never runs without separate setup approval.
3. No-T3 smoke: remove/rename T3 executable and state directory, launch worktree-only subagent, assert no listener/process/SQLite access and successful cwd.
4. Setup lifecycle with harmless fixture command only: spawn failure, async zero/nonzero, waited zero/nonzero, cancellation before/after spawn, process crash/restart. Assert one durable attempt, accurate result, and no implicit retry.
5. Web portability: import from t3.json, edit local action, verify repo file does not change today. Proposed export requires explicit confirmation and produces a CLI-readable file whose digest matches.

## Unknown / not established
- No guarantee was found that T3's setup runner is exactly-once across server crash/restart or that a failed setup can be safely replayed.
- No documented T3 project-source trust database/gate was found for t3.json. The import click is the observed consent boundary.
- No existing Die mapping from Pi trust to Git common-dir/repository identity was found.
- No official t3.json action export path was found.
- Whether the product wants local-mode new threads to keep running the setup action is a policy question: current `ThreadLaunchService` invokes the setup runner after workspace resolution even when no worktree is created. Only progress tracking is worktree-specific.
