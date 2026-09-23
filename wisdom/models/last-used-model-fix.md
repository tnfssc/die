# Last-used model retention fix

## Ownership and baseline

- This parallel task owned the work. Main / `task_b210d06d` still owned integration.
- Source edits stayed in isolated `/var/tmp/die-last-used-model`.
- Canonical T3 source: `a9b49a7df0a4261dcc438d4493cc3154a1d9819e` plus a snapshot of `web/t3.patch`.
- Baseline patch SHA-256: `62d76004e90bb4b95ca7b1477049f1a9f0c149ccc9eb2ca5280ac32c6f47bbf0`.
- Incremental artifact: `.agents/patches/last-used-model-incremental.patch` (SHA-256 `3322fbb4399ecb1d0c0035a481e1c1889239823872c9cb31c63c76c9ba8e3024`).
- The work did not touch root source, the shared cache or canonical checkout, `web/t3.patch`, indexes, native or workspace files, user state, credentials, installs, commits, or releases.

## Confirmed web bug and fix

The existing web patch already records explicit picker choices in persisted `stickyModelSelectionByProvider` and applies that state to a new draft. Two later seeds incorrectly erased it:

1. `useHandleNewThread` treated the model saved on the currently viewed/resumed thread as fresh new-thread intent. Thus resumed A could replace the user's last explicit B in a new blank thread.
2. Both new-thread creation and blank-draft project switching treated the environment-wide startup default as though it were an explicit project pin. That default replaced sticky B.

The incremental fix:

- carries a model from another draft only when its composer selection is marked explicit;
- lets only a true project-scoped `defaultModelSelection` source override sticky state;
- keeps explicit project pin > explicit carried/new-thread selection > persisted last explicit picker selection > environment fallback;
- applies the same path after worktree context setup, so local/worktree draft creation has identical model behavior;
- does not modify reasoning/model options, interaction/agent mode, runtime mode, or workspace/child profile data.

Provider identity is retained in the full `ModelSelection.instanceId`. Existing inventory resolution remains in `resolveComposerProviderSelection` / `deriveEffectiveComposerModelState`: unavailable saved selections are presented honestly (including an unavailable row where supported) rather than silently rerouted, while provider fallback is deterministic. No RPC/model call was added: picker persistence and new-draft seeding are local Zustand store operations.

Existing/resumed threads are not rewritten: `applyStickyState` runs only in new/reusable blank-draft flows, and explicit composer picks remain protected by `hasExplicitComposerModelSelection`.

## CLI investigation (no CLI defect/change)

The CLI has a distinct, intentional policy:

- ordinary `/model` changes are session-local and recorded in session history, so resume restores that session's saved model;
- Ctrl+S in `/model` explicitly saves `defaultProvider` + `defaultModel` for future sessions;
- explicit `--model` remains the startup override.

This is documented in Pi's `docs/extensions.md` (`setModel` does not alter defaults), `docs/settings.md` (Ctrl+S saves startup model/thinking defaults), and `docs/usage.md`. Internal prompt preview uses in-memory settings, and subagent jobs pass explicit `--model`; neither mutates user defaults. Therefore the confirmed report is T3 web, not a genuine CLI persistence regression, and no root/CLI patch is proposed.

## Tests and proof

Incremental tests cover:

- resumed A remains A while blank and worktree-targeted drafts seed sticky B;
- explicit per-thread C wins afterward;
- sticky B survives persisted-store rehydration;
- a resumed thread's non-explicit saved model does not override sticky state;
- an environment default is fallback, not an explicit override;
- explicit carry and explicit project pin precedence remain intact.

Commands/results in the isolated checkout:

- `vp fmt` on all five touched files: passed.
- `git diff --check`: passed.
- temporary-index apply check against the exact canonical patch baseline: passed.
- focused `chatThreadActions.test.ts`: **12 passed**.
- `composerDraftStore.test.ts` could not start with reused dependencies: the available shared dependency tree belongs to a newer T3 source and mixes incompatible Effect/contracts APIs with pin a9b49a7d (`transformEffect is not a function` / `ThreadContextRecord` mismatch). No dependency install was performed. Main should run this focused test after applying the incremental patch in its final dependency-consistent integration checkout.

No prompt text changed, so prompting documentation was not applicable.
