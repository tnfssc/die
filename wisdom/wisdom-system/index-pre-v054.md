# Project notes

- **Editing prompts? Start with [the prompt editing guide](../../docs/prompts.md).** It explains how to review the whole input, keep decision reasons, and inspect assembly. [Model input source map](../../docs/system-instructions.md) lists sources and inclusion conditions.
- [Prompt review and shell stdin](prompt-review-2026-09-12.md): user-approved values, review position, stdin decision, and verified checks.
- [Durable prompt iteration](prompt-iteration-2026-09-13.md): review applied. Luna/medium live failures, Astra handoff and Sol memory success. Keep design. Future checks target Sol/Astra. Process-scope incident recorded. Shipped in v0.2.6.

- [Conversation spacing](thinking-spacing.md): compact thinking/non-user boundaries. Plain unhighlighted rows around user messages. Installed. User confirmed.

- [Releases and Herdr sidebar investigation](releases-herdr-2026-09-13.md): v0.2.8 published and verified. Spacing/Herdr fixes installed, sidebar recovered, tests isolated. No pending jobs.

- [Failed Go experiment](go-experiment.md): archived in ac80ddd, then removed at user request. Original app unchanged.

- [Execution row cleanup](ui-cleanup-2026-09-14.md): compact execute/task labels, truncated indicator, prose-only spacing. In progress.

- [Native compaction coverage investigation](native-compaction-coverage-2026-09-14.md): strict timestamp identity can falsely reject reconstructed task completions. Current warning traced, no fix yet.

- [v0.2.9 release](release-v029.md): install/push/release authorized. Full validation in progress.

- [Shake-first compaction](auto-shake-compaction.md): active feature. >=75% character reduction chooses shake before native/normal compaction.

- [v0.2.10 release](release-v0210.md): release/install authorized, validation underway.

- [Temporary die web feasibility](die-web-feasibility.md): research only, T3 Code bridge until official Pi support. Repo clones and tvly evidence.

- [Full die web plan](die-web-full-plan.md): supersedes temporary bridge. Mapping Claude/Codex agent/task support and maintainable T3 updates.

- [Minimal die web implementation](die-web-implementation.md): current official T3 6f00d38 /0.0.40 installed and installed-browser verified. No web pairing on loopback, origin guards, model switching and sparse Agents status. Not committed/released. Optional T3 MCP browser tools unsupported.

- [v0.2.11 release](release-v0211.md): optional local web UI, task status, Stop fix. Publication/install tracking.

- [v0.2.12 release](release-v0212.md): correct fresh-build cache path after unpublished v0.2.11 CI failure.

- Web Mode selector implemented and locally installed after v0.2.12: see final section of [web implementation](die-web-implementation.md). Source patch and smoke are uncommitted.

- [v0.2.13 release](release-v0213.md): Mode selector and direct dropdown trigger publication tracking.

- [Current native compaction incident](native-compaction-current-incident.md): confirmed journal-only empty failed assistant causes coverage false rejection. Narrow fix tested (612 pass) and CLI installed locally. User must restart/resume old v0.2.10 process. Single-binary work remains paused.

- [Single-binary packaging](single-binary-packaging.md): Bun-only CLI/web candidate passed browser terminal/chat/Mode/model/Stop and 616 core tests. Preparing v0.2.14. V0.2.13 tag remains immutable.

- [v0.2.15 release](release-v0215.md): v0.2.14 failed backend TS validation. Corrected final check pipeline and PTY tests, 616 core +121 backend tests passing. Next release pending.

- Upcoming v0.3.0: user requested `die update`. Worker implementation started. Official GitHub stable release, checksum verification, atomic self-replacement, no downgrade/source-Bun overwrite. Keep separate from running v0.2.15 releaseCI.

- [v0.3.0 updater](update-v030.md): `die update` implemented and verified (635 full tests passed), no v0.3.0 release yet. Installed binary remains official v0.2.15.

- [v0.3.0 release](release-v030.md): user authorized install/push/release. 635 core +121 backend tests and browser checks passed, release preparation underway.

- [Dependency update and v0.3.3](deps-release-v033.md): npm and T3 v0.0.42 updates plus terminal/web handoff visibility fixes. V0.3.3 published and official Linux binary verified.

- [Shared memory value](shared-memory-value.md): approved plain-language value makes code and notes part of finishing work. Prompt delivery tested.

- [Blacksmith CI request](blacksmith-ci.md): blocked by personal-repository ownership. No workflow changes or new release. Needs user decision.

- [v0.3.4 release](release-v034.md): shared-memory value, GitHub runners retained. Published and official binary verified. README now advertises web UI and Herdr.

- [Deep memory/resource audit](leak-audit.md): completed deep CLI/web source and isolated runtime investigation. Integrated report docs/memory-resource-audit.md, reproducible probes. No product fixes applied.

- [Audit judgment](leak-audit-judgment.md): follow-up merit-based fix decisions, independent challenges, desktop reachability correction. No implementation. See docs/memory-resource-judgment.md.

- [v0.4.0 resource fixes release](resource-fixes-release.md): published and official Linux checksum/version verified. Disk-backed history, bounded output/terminal queues, lifecycle/log/cache fixes. No local installation performed.

- [v0.5.0 release](release-v050.md): published and verified. All four binaries/checksums and 12 asset digests validated, official Linux reports 0.5.0. No local install, concurrent work preserved.
- [T3 orchestration-v2 upstream research](t3-v2-upstream-research.md): real delegated-thread API on unmerged #2829, distinct from Codex v2 and merged status bridge.
- [Pinned T3 thread execution](t3-thread-execution-research.md): actual pin lives in `.cache/die-t3code-v0042`. Ownership, RPC, projections, child execution options.
- [Die/T3 thread integration options](die-t3-thread-options-research.md): projection vs backend-owned delegation. Provisional pending combined review.

- [T3 thread research synthesis](t3-thread-research-conclusions.md): four reports complete. Real v2 API/UI and Pi adapter found upstream. Isolated feasibility spike recommended, Die execute-only tool exposure needs validation.
- [T3 task GUI research](t3-task-ui-research.md): pinned lifecycle-only UI, persistence and subscription trace.

- [Active T3-v2 prototype](.pending/t3-v2-experiment-active.md): user approved isolated experiment. Implementation and independent acceptance workers running.

- [T3-v2 experiment results](t3-v2-experiment.md): real engine/MCP/Die delegation and Chromium persisted child transcript verified. Prototype in `experiments/t3-v2/`, not adopted. Live streaming/recovery/routing enforcement remain.

- [Production T3-v2 work active](.pending/t3-v2-production-active.md): user authorized production implementation and resource/regression hardening. Implementation and independent requirement/resource audits running. No release/install authorized.

- [t3-v2-production-lifecycle-final.md](t3-v2-production-lifecycle-final.md): final adopted T3-v2 source/hash, exact unowned local-shell wake cause and durable ownership fix, canonical same-binary acceptance, resource evidence, rollback and limitations (supersedes earlier non-adopted final note).

- [Canonical T3-v2 adoption and lifecycle fix](t3-v2-production-lifecycle-final.md): supersedes prior NOT-ADOPTED notes. Canonical a9b49a7d and exact built binary pass native/live-browser/preservation/package/migration gates, 721 root tests. No release/install.

- [CLI-first worktree design](t3-worktree-design.md): new user constraint—worktree subagents must work without starting T3. Shared API, local Git backend, setup-config portability unresolved.

- [CLI-first worktree investigation active](.pending/worktree-investigation-active.md): four read-only research tracks on setup portability/trust, local lifecycle, web prep, and Git safety. No implementation yet.

- [Worktree investigation conclusions](worktree-investigation-conclusions.md): completed CLI-first API/setup/trust/lifecycle/Git research. Reuse t3.json declarations with explicit approval, local Git CLI and deferred native child prep web. No implementation yet.

- [Workspace feature and combined PR active](.pending/native-workspace-pr-active.md): user authorized implementation and PR. Branch `feat/native-task-workspaces`, implementation/prompt/readiness owners assigned. Main owns commit/push/PR. No release/install.

- [Last-used model fix](last-used-model-fix.md): new user report, isolated parallel implementation pending. Retain explicit user selection for new sessions without changing resumed threads or mode/profile policy.
- [Web runtime ffi-rs portability fix](web-ffi-rs-portability-fix.md): fixes macOS arm64 `die web` missing `@yuuang/ffi-rs-darwin-arm64` by widening T3 pnpm supportedArchitectures and adding deploy verification. Check/apply validation passed, full web rebuild not run.

- [Die-only first launch providers](die-only-first-launch.md): user requested default only Die enabled. Worktree implementation and tests running.

- [Persistent worktree instructions](worktree-location-instructions.md): updated orchestrator prompts to managed/persistent paths. 15 tests pass, not rebuilt.

- [Dependency update and next release](deps-release-v054.md): Pi 0.87 compatibility underway in isolated worktree. No release yet.
