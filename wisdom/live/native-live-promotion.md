# Native Live promotion

User asked to make the working Live Lab the only Live implementation, then
asked for direct /live entry and a careful, minimal setup flow. This is a
replacement, not a compatibility layer. Historical release notes keep their
old names; active code, commands, tests, build paths and docs use Live.

## User-visible contract

- /live toggles voice. Idle starts directly; running stops; connecting
  cancels startup. No action picker or extra Start confirmation. Explicit
  /live start and /live stop remain idempotent choices.
- Missing Google API key leads to focused setup. Setup itself opens no
  devices and makes no paid connection. No keys entered into chat.
- Reuse provider credentials. Explicit import only; preserve existing Google
  OAuth and other provider auth. Do not make users choose unrelated tools.
- /live stop stops voice, not agent work. /live status shows diagnostics on
  request. mic-check and speaker-check stay opt-in diagnostic commands, not
  an entry menu. /live setup remains available for configuration.
- Short labels and clear actions. No repeated subtitles, warning paragraphs,
  redundant notices or technical banners in ordinary use. Keep necessary
  privacy/cost information at the action that needs it.
- Native full-duplex capture, startup fix, bounded playback cushion, reply
  tails, interruptions and current-session agent tools remain intact.

The user reports the installed playback candidate works well. That is real
user feedback, not exhaustive route/double-talk evidence. See
[local speaker trial](macos-speaker-local-trial.md).

## Ownership and recovery

Integration: /Users/sharath/Private/home/Code/die, branch feat/native-live.
Base ffbccf3 includes the tested playback cushion and local installation proof.

- Runtime task_b59c92bf: worktree
  /Users/sharath/.die/worktrees/die-f528e86af6b5-task_b59c92bf,
  branch die/promote-live-with-direct-entry-and-minim-b59c92bf.
  Owns src/live and src/live-lab, task host imports, runtime tests and setup.
- Packaging task_733f377a: worktree
  /Users/sharath/.die/worktrees/die-f528e86af6b5-task_733f377a,
  branch die/promote-live-packaging-and-cli-733f377a.
  Owns native/helper/script renames, CLI registration, workflows, local
  installer and three packaging tests (embedded-helper/platform/setup-diagnostics).
- First runtime task_d51c2ba5 was stopped before edits to give it the user's
  latest UX requirements. Its worktree is retained but has no findings to merge.
- Parent owns integration, product/support docs, remaining references and
  compiled onboarding smoke. Workers do not install or release.

Canonical names: src/live, native/live, native/live-linux, LiveAudio,
LiveDependencies, liveExtension, die-live, die:live:host-access, live-audio,
live-audio-linux, --live-self-test, --live-helper, build-live-helper.sh,
build-live-linux-helper.sh and live-helper-bundle.ts. No lab alias.

## Review gates

- Inspect old dependencies before deleting. tests/live-dispatch-budget.ts
  also serves goals/sdk tests; "live" there means paid LLM tests, not voice.
  Keep unrelated helpers and tests.
- Remove obsolete SoX tests (tests/audio.test.ts) or replace meaningful
  coverage with native tests. No old transport left only to satisfy tests.
- Update compiled onboarding smoke to new UX. No real credentials/devices.
- Check tests/release-workflows.test.ts, support/live-lab-candidate.md, and
  package script names. No new prerelease bundle or redundant release matrix.
- Verify direct /live, safe auth/setup cancellation, host tools, native
  startup, interruption, full tails, bounded queues, packaged helper/updater.
  Run full deterministic suite, typecheck, native build/self-test and compiled
  UI smoke where available before installation/release claims.
- Preserve historical notes rather than rewriting old release evidence.

No promotion code integrated or installed yet. Values unchanged for now:
existing simplest-useful-design and truthful-UI guidance cover this work.

## Autocomplete follow-up

User explicitly asked for autocomplete. Parent owns final integration of
/live argument completions: stop, setup, status, mic-check, speaker-check
(and start if retained as synonym). Bare /live starts directly. Command
registry should expose only live, not live-lab. Add tests for prefix filtering
and empty/unknown input using the existing ExtensionAPI completion contract.
Runtime worker was already running when this was added; parent must check
and supply it after integration rather than assume worker saw this request.

## Latest toggle requirement

User changed bare /live from start-only to toggle. Parent owns this final
integration change (worker was already running). Test idle->start, running
->stop, connecting->cancel with no late activation, explicit start stays
start-only, explicit stop stays stop-only. No agent job cancellation. Update
README/product copy and autocomplete together.

## Packaging integration

Packaging worker943f143 integrated on feat/native-live (see git log for
cherry-pick hash). Parent reviewed native rename: AudioCore.c unchanged;
Swift/C++ edits are names and paths, not DSP/graph changes. Local installer
now validates staged version and Mac embedded helper before atomic replace.
Worker native sanitizer/compile/self-test and minimal embedding checks passed.
Parent installer/release tests passed20 tests before final CI cleanup.

Parent removed old optional experimental bundle steps from live.yml and
support/live-lab-candidate.md instead of renaming that parallel delivery path.
Normal release workflow remains the delivery path. Existing native-helper
workflow remains device-free; no new matrix. Removed SoX install/probe from
Mac CI and pointed its deterministic tests at native Live tests.
Updated README, PRODUCT draft, native README and release test paths.
Compiled onboarding smoke draft now checks bare /live missing-key flow and
explicit import, no paid test menu, no displayed key. Must run after runtime
integration; do not assume unit copy alone proves terminal rendering.

Latest user requirements (toggle + autocomplete) arrived while runtime worker
was running. Parent must apply/test both after cherry-pick. No install yet.
