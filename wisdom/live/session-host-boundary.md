# Shared session host boundary

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_054bb11a-a86675007a5e-task_803961bd
Branch: die/shared-session-host-boundary-803961bd

The tasks extension remains the sole owner of JobService and TaskManager. Shared `src/session/host.ts` owns session/branch checks, bounded request replay, trusted send and cancellation confirmation, snapshot persistence and watchers. It only sees an explicit `SessionTaskPort`: scoped list/inspect/stop, local job summaries, and task updates. The adapter in `src/tasks/extension.ts` calls the existing service with the same context, signal and inspect limit. Do not add a second task scheduler to a voice client.

The event-bus access key now names the shared session; only the tasks extension registers the host. The host survives voice reconnects until owning session shutdown. Tests exercise real extension access, adapter-backed TaskManager/JobService calls, and an isolated port proving confirmation and session scope prevent stop dispatch. Transcript custom-entry and snapshot payload formats are unchanged. Integration completed: transcript history and its stable custom-entry discriminator now live in `src/session/transcript.ts`; shared session modules have no Live or task implementation imports. The delegation prompt still names GPT-Live, because provider behavior/prompt is out of scope.

Snapshot tests share a real per-UID temp budget; on a machine with retained files, run them under a fresh `TMPDIR`. Do not clear another session's snapshot store to make tests pass. No values change: existing single-owner, bounded-resource and truthful-handoff values cover this boundary.


## Integrated refactor (2026-09-25)

Owner worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_054bb11a
Owner branch: die/integrate-live-with-shared-die-session-c-054bb11a
Worker commit: 8e65aa0 (integrated as b870d61, resolving transcript import). Shared input/history extraction: ad16b51.

Actual dependency problem: tasks imported a Live host which owned session scope, input dispatch, history snapshots and task watchers. Now tasks composes `SessionHost` with a small explicit port to its existing JobService/TaskManager; both execute-tool and voice operations use that service. `SessionOperations` is the provider-independent consumer contract, implemented by the shared host. No new scheduler or alternate agent delivery path was introduced.

Shared `CompletedInput` owns completed-input TTL, revocation, consumption and non-evictable attempt IDs. Live orchestration retains provider tool declarations, argument validation and mapping to session operations. Received history cannot grant input authority. Shared transcript storage accepts normalized replacement semantics rather than importing provider types; Live interprets model-contract finality. GPT-Live timestamp grouping stays in Live because it adapts provisional provider fragments, not authoritative turns. Stable voice entry labels, snapshot format/location/budgets, request semantics and trusted cancellation confirmation remain intact.

Deliberate scope: audio/socket/playback lifecycle and the voice stop bus stay in Live. Owning-session scope, replay, watcher cleanup and host close belong to session code, wired by tasks shutdown. No generalized transport framework, synthetic session runtime, or cosmetic sweep of provider files. Shared handoff prompts still describe voice/provisional GPT-Live evidence where that is the actual source; text input was not rerouted through a voice-only permission policy.

Existing values cover this work (clear ownership, bounded state, truthful authority and evidence); no values edit warranted. No release, installation or push; main checkout was not edited. Local validation uses existing dependency symlinks (including cached @types/ws absent from main node_modules), not dependency installation.

Native Pi message entries remain the authoritative text conversation. The shared host reads that same branch for recent user/agent context; normalized received-voice entries supplement it, not a second conversation store. The session extraction does not invent a replacement for Pi history.

## Validation and remaining gaps

- `bun run check`: passed on integrated code. Changed-file Biome format check and `git diff --check`: passed.
- `bun scripts/build.ts --reuse-web`: compiled this worktree CLI successfully using a private copy of existing web assets. A fresh `bun run build` was blocked by missing pnpm; it did not validate a fresh web rebuild. Nothing was installed or released.
- Full offline `bun test ./tests`: **1,051 pass, 17 skip, 0 fail**, 140 files / 27,125 assertions. Ran against the newly compiled CLI with all LLM/provider acceptance flags disabled and an isolated TMPDIR for snapshot budgets. Log: `/tmp/live-integrated-full-trusted.log` (ephemeral validation artifact).
- First full run had 10 shell-output failures because fish printed untrusted-mise warnings for this new worktree. Setting `MISE_TRUSTED_CONFIG_PATHS=$PWD` only in the test process resolved all 10; no persistent trust or main-checkout change. An earlier targeted run lacked dist/die and therefore failed three compiled-runner/footer tests; all passed after compilation.
- Added direct completed-input/history authority tests, port/cancellation/scope tests, and dependency-boundary guards (session cannot import Live/task implementations; tasks cannot import Live). Existing transcript, branch snapshot, reconnect, realtime ordering, cancellation, delegation, and provider mock tests pass.
- No paid provider, microphone, speaker, or real native backend acceptance performed. Offline protocol/adapter tests do not establish live audio UX. Fresh web rebuild and real-device/provider acceptance remain outside this bounded refactor.

## Main checkout integration

Fast-forwarded through `acc952f` after parent review. Focused session/Live tests in this checkout: 101 passed, 0 failed with a fresh TMPDIR. The first run hit existing snapshot capacity (4 failures); no existing snapshots were removed. Main checkout typecheck is blocked by missing installed `@types/ws`, already declared at 8.18.1 before this change. Worktree typecheck above used that cached dependency and passed. Main dependency installation was left alone. `git diff --check` passed.
