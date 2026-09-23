# Last-used model follow-up (2026-09-23)

The user said the last-used model still did not work, but had not yet said whether this meant terminal or web. We asked. The earlier fix covered web. It deliberately kept ordinary CLI `/model` changes local to one session; Ctrl+S saved defaults. That looked like the likely expectation gap, but was not yet proven.

Investigation and implementation went to `task_13898849` in `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_13898849`, branch `die/investigate-last-used-model-persistence-13898849`, base `0834f2b76ea0a1b20ed36ba0f954e977c23d6101`. The worker was to check both paths and test a narrow explicit-selection persistence fix. It was not to change user settings or the installed executable. Worker findings, user clarification, integration, and review were still pending.

User clarified: **terminal**. Scope is CLI, not web. Implement automatic persistence of explicit user model choices.

## Worker findings and implementation

Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_13898849`  
Branch: `die/investigate-last-used-model-persistence-13898849`

The report was initially ambiguous, so both surfaces were inspected. The existing web patch still contains the sticky explicit-picker state and the precedence guards from `last-used-model-fix.md`; no new web regression was confirmed in this checkout. The user subsequently clarified that the affected surface is the terminal CLI.

The CLI gap was real as an expectation mismatch: Pi's model selector and `/model <name>` call `session.setModel(model, { persist: false })`. Only Ctrl+S in the selector previously persisted `defaultProvider` and `defaultModel`. Session history therefore restored the choice only when resuming that session, while an unrelated new CLI session continued using the old default.

Implemented `src/tasks/last-used-cli-model.ts` and registered it in the existing Die extension. A `model_select` persists provider + model only when all of these are true:

- event source is `set` (the selector/`/model` path) or `cycle` (the direct model-cycle key), never the automatic `restore` source;
- mode is `tui`, not print/JSON/RPC automation;
- the active identity is the root session, not a spawned or restored child.

This preserves resumed-session history and explicit startup `--model` precedence: initial command-line selection is applied during session construction rather than as a user `set` event. Spawned children are additionally excluded by dynamic root identity, so their explicit routing models cannot rewrite defaults. Persistence uses Pi's lock/merge-aware `SettingsManager`, preserving unrelated settings.

Caveat: Pi 0.87's public `model_select` event identifies `set | cycle | restore` but does not identify the specific UI control. A third-party extension calling `pi.setModel()` in the root TUI would also appear as `set`. Die itself has no such internal call; its routing/fast-mode/compaction paths do not call `setModel`. The TUI/root/source guards are therefore exact for current Die behavior but not a general provenance guarantee for arbitrary future third-party extensions.

## Validation

- `bun test tests/last-used-cli-model.test.ts`: **3 passed**, covering direct root TUI persistence and persistence of selector/cycle choices and exclusion of restore, noninteractive command override, and child events.
- `bun x tsc --noEmit` after `bun run prepare:assets`: passed.
- `git diff --check`: passed.

Validation used the existing dependency tree from the main checkout via a temporary symlink because this worktree had no `node_modules`; the symlink was removed afterward. No dependency was installed, no executable was built/installed, and no user settings were read or changed by tests.

## Main integration

User additionally requested dependency updates (worker task_65e8e889, worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_65e8e889, branch die/update-project-dependencies-65e8e889) and authorized push and release once complete. Main cherry-picked CLI fix; combined validation/release pending. Anticipated release v0.5.8, subject to remote check.
