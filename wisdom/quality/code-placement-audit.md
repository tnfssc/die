# Code placement audit (2026-09-25)

User found Live prompt text outside `src/prompts/` and asked for other scattered files, not just prompts. Audit first. No broad moves yet. Look for one concept with split ownership, not files that only look alike. Keep feature-local code when its owner is clear.

Three read-only audits run from `71a9dbf`:
- Prompts and config: task `task_f4d6bcd0`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_f4d6bcd0`, branch `die/audit-prompt-and-config-placement-f4d6bcd0`.
- Runtime ownership: task `task_523c4f19`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_523c4f19`, branch `die/audit-runtime-ownership-and-shared-logic-523c4f19`.
- Scripts, assets, tests: task `task_d8322538`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_d8322538`, branch `die/audit-scripts-assets-and-test-organizati-d8322538`.

Audit complete. Parent checked the named sources and callers. Findings below are a cleanup plan, not runtime validation. No product edits from this audit. CI repair is separate and takes priority; see `../ci/local-ci-integration.md`.

## Checked findings so far

- Live instruction prose is split between `src/live/prompt.ts` and `src/live/gpt-live-session.ts`. Both belong as separate text sources under `src/prompts/`. Keep protocol-specific wording distinct. `src/prompts.ts` assembles text; `src/system-prompt.ts` decides base-prompt precedence. Those are separate jobs.
- Live model IDs are partly in `src/live/types.ts` (`VOICE_MODEL`), partly in `src/live/providers.ts`, with GPT-Live wire literals in its session. `providers.ts` is the existing metadata owner. Move identifiers there, not transport validation.
- `src/tasks/t3-native-task.ts` repeats the local profile enum from `src/tasks/subagent-profiles.ts`. Derive its enum values from `SUBAGENT_TYPES`; keep the wire schema separate. Do not import host code across the separately built web boundary.
- `support/die-web-bootstrap.mjs` is maintained executable web packaging code. `web/` is a clearer home. Three builders copy it; keep the packaged filename and archive bytes unchanged when moving it.
- Candidate and production web builders repeat packaging steps. Candidate inputs and safety gates intentionally differ. Only share packaging operations if the candidate is still maintained; do not revive old experimental machinery just for tidiness.
- Release workflow hardcodes `support/release-v0.11.1.md` apart from its package version check. This is a drift issue rather than a folder issue. Select notes from the validated release version and fail if absent.

Preserve the canonical `web/t3.patch` and derived build outputs as distinct things. Keep shared native contract fixtures and native protocol tests where their consumers expect them. 

## Shared runtime ownership

- `src/typescript/job-bridge.ts:69–143` owns acknowledgement and request-identity helpers used by `tasks/job-service.ts`, `tasks/task-manager.ts`, and `tasks/foreground-stop.ts`. Extract the shared delivery contract into a small named module; keep IPC transport in the bridge. This is the riskiest move: preserve signal identity, acknowledgement timing, and cancellation cleanup. Run bridge/protocol/foreground-stop and T3 integration tests.
- `src/tasks/output-buffer.ts` is shared by task output and execute image capture (`src/typescript/execution.ts`). A neutral `src/output-buffer.ts` is clearer. Move without changing byte offsets, truncation or capacity policy. Run output-buffer, task manager and execution tests.
- `src/tasks/t3-mcp-client.ts:3–15` owns delegation credential names and child-environment scrubbing used by execute and task launches. A small delegation-environment module would let both use that security rule without depending on the MCP transport client. Keep URL/auth/retry behavior in the client; test every child-launch path still removes both credentials.
- `src/tasks/session-cost-root.ts` creates session identity used for both costs and child parent links. A name under `src/session/` would describe its actual job. Lower priority; preserve synthetic IDs and per-cwd paths exactly.

Do not merge branch-identity validation, resume metadata readers, and cost parent-link parsing. They serve different authority/failure rules. Likewise Live provider transcript fragments and authoritative session transcript entries are different layers.

## Order

1. Fix the red CI and use one shared local/CI gate.
2. Move Live prose to the existing prompt folder. Consolidate local model/profile identifiers.
3. Move the buffer and web bootstrap with no behavior changes.
4. Extract shared environment and delivery contracts in separate tested changes. Rename session identity when touching that area.
5. Decide whether old candidate tooling is still needed before sharing its packager. Treat versioned release-note selection as a separate correctness fix.

Values: clarified value 3 with this recurring lesson. Shared rules belong with their real owner; feature-local code and separate trust boundaries need not be merged.

## Runtime placement completed

`src/output-buffer.ts` owns the unchanged bounded byte buffer for task output and execute image capture. `src/job-delivery.ts` owns shared acknowledgement, request identity and cancellation signal metadata; `src/typescript/job-bridge.ts` retains the IPC transport and execute globals. `src/delegation-environment.ts` owns the T3 credential names and child-environment scrub rule; MCP configuration and HTTP remain in the client. `src/session/identity.ts` provides `sessionIdentity` for cost attribution and parent links, preserving Pi per-cwd paths and ephemeral synthetic IDs. No compatibility reexports: call sites, tests and leak-audit script import the owning modules directly. Historical resource audit paths remain historical evidence.

Proof (runtime placement): `bun run check` and targeted Biome format pass. Focused suites passed: 132 tests across buffer, session identity, bridge/protocol, foreground stop, execute, task manager, T3 routing/production and stop-work; 66 tests across job service, session costs, notifications, routing and manager. The execute tests used a locally compiled CLI with a placeholder web archive because the full web build requires `pnpm` (not available in this worktree). That substitute does not validate web packaging; the separate packaging worker owns that gate. Values unchanged: the existing shared-rule ownership guidance already covers this move.
