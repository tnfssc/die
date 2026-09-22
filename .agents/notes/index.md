- [Official T3 preview adoption and final acceptance](t3-preview-adoption.md) — pinned preview, semantic/resource repair, final package/live/security/current-production migration evidence and parent release handoff (2026-09-22).
# Project notes

- **Editing prompts? Start with [the prompt editing guide](../../docs/prompts.md).** It explains reviewing the whole input, decision reasons, and how to inspect assembly. [Model input source map](../../docs/system-instructions.md) lists sources and inclusion conditions.
- [Prompt review and shell stdin](prompt-review-2026-09-12.md): user-approved values, review position, stdin decision, and verified checks.
- [Durable prompt iteration](prompt-iteration-2026-09-13.md): review applied; Luna/medium live failures, Astra handoff and Sol memory success. Keep design; future checks target Sol/Astra. Process-scope incident recorded; shipped in v0.2.6.

- [Conversation spacing](thinking-spacing.md): compact thinking/non-user boundaries; plain unhighlighted rows around user messages. Installed; user confirmed.

- [Releases and Herdr sidebar investigation](releases-herdr-2026-09-13.md): v0.2.8 published and verified; spacing/Herdr fixes installed, sidebar recovered, tests isolated. No pending jobs.

- [Failed Go experiment](go-experiment.md): archived in ac80ddd, then removed at user request. Original app unchanged.

- [Execution row cleanup](ui-cleanup-2026-09-14.md): compact execute/task labels, truncated indicator, prose-only spacing; in progress.

- [Native compaction coverage investigation](native-compaction-coverage-2026-09-14.md): strict timestamp identity can falsely reject reconstructed task completions; current warning traced, no fix yet.

- [v0.2.9 release](release-v029.md): install/push/release authorized; full validation in progress.

- [Shake-first compaction](auto-shake-compaction.md): active feature; >=75% character reduction chooses shake before native/normal compaction.

- [v0.2.10 release](release-v0210.md): release/install authorized, validation underway.

- [Temporary die web feasibility](die-web-feasibility.md): research only, T3 Code bridge until official Pi support; repo clones and tvly evidence.

- [Full die web plan](die-web-full-plan.md): supersedes temporary bridge; mapping Claude/Codex agent/task support and maintainable T3 updates.

- [Minimal die web implementation](die-web-implementation.md): current official T3 6f00d38 /0.0.40 installed and installed-browser verified; no web pairing on loopback, origin guards, model switching and sparse Agents status. Not committed/released; optional T3 MCP browser tools unsupported.

- [v0.2.11 release](release-v0211.md): optional local web UI, task status, Stop fix; publication/install tracking.

- [v0.2.12 release](release-v0212.md): correct fresh-build cache path after unpublished v0.2.11 CI failure.

- Web Mode selector implemented and locally installed after v0.2.12: see final section of [web implementation](die-web-implementation.md); source patch and smoke are uncommitted.

- [v0.2.13 release](release-v0213.md): Mode selector and direct dropdown trigger publication tracking.

- [Current native compaction incident](native-compaction-current-incident.md): confirmed journal-only empty failed assistant causes coverage false rejection; narrow fix tested (612 pass) and CLI installed locally. User must restart/resume old v0.2.10 process. Single-binary work remains paused.

- [Single-binary packaging](single-binary-packaging.md): Bun-only CLI/web candidate passed browser terminal/chat/Mode/model/Stop and 616 core tests. Preparing v0.2.14; v0.2.13 tag remains immutable.

- [v0.2.15 release](release-v0215.md): v0.2.14 failed backend TS validation; corrected final check pipeline and PTY tests, 616 core +121 backend tests passing; next release pending.

- Upcoming v0.3.0: user requested `die update`. Worker implementation started; official GitHub stable release, checksum verification, atomic self-replacement, no downgrade/source-Bun overwrite. Keep separate from running v0.2.15 releaseCI.

- [v0.3.0 updater](update-v030.md): `die update` implemented and verified (635 full tests passed), no v0.3.0 release yet; installed binary remains official v0.2.15.

- [v0.3.0 release](release-v030.md): user authorized install/push/release; 635 core +121 backend tests and browser checks passed, release preparation underway.

- [Dependency update and v0.3.3](deps-release-v033.md): npm and T3 v0.0.42 updates plus terminal/web handoff visibility fixes; v0.3.3 published and official Linux binary verified.

- [Shared memory value](shared-memory-value.md): approved plain-language value makes code and notes part of finishing work; prompt delivery tested.

- [Blacksmith CI request](blacksmith-ci.md): blocked by personal-repository ownership; no workflow changes or new release. Needs user decision.

- [v0.3.4 release](release-v034.md): shared-memory value, GitHub runners retained; published and official binary verified. README now advertises web UI and Herdr.

- [Deep memory/resource audit](leak-audit.md): completed deep CLI/web source and isolated runtime investigation; integrated report docs/memory-resource-audit.md, reproducible probes; no product fixes applied.

- [Audit judgment](leak-audit-judgment.md): follow-up merit-based fix decisions, independent challenges, desktop reachability correction; no implementation. See docs/memory-resource-judgment.md.

- [v0.4.0 resource fixes release](resource-fixes-release.md): published and official Linux checksum/version verified; disk-backed history, bounded output/terminal queues, lifecycle/log/cache fixes. No local installation performed.

- [v0.5.0 release](release-v050.md): published and verified; all four binaries/checksums and 12 asset digests validated, official Linux reports 0.5.0; no local install, concurrent work preserved.

- [Pi 0.87 upgrade](pi-0.87-upgrade.md): transcript migration, lazy-history parity, patched-web API review, license updates, and validation/worktree record.

- [Release verification preference](release-verification-preference.md): user says no automatic post-release binary downloads solely to recheck CI-generated checksums; rely on passing CI and confirm publication.
