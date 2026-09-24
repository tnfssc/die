# Native Live promotion

Current state: integrated on feat/native-live and installed locally on the
user’s Apple Silicon Mac. /live toggles, action autocomplete works, /live-lab
is gone. See final validation and installation below. No release published.

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

Initial plan had no promotion code integrated or installed. Values unchanged:
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

Parent rebuilt renamed native helper locally: build/self-test passed. Installer
tests remained green; release test first rerun failed only because one old
assertion still required Homebrew SoX. Updated it to the native fake-provider
suite, keeping no-device/no-credential checks. Full rerun after runtime merge.

## Runtime integrated; final checks running

Worker8993e89 integrated as970fa68. Native runtime/tests now live under
src/live and tests/live-*. Old SoX/custom bridge/transport removed; unrelated
LLM dispatch-budget helpers retained. Parent added bare toggle (including
pending auth/setup/helper/provider cancellation), explicit idempotent start
and stop, and prefix-filtered action autocomplete. Command factory only
registers live. No runtime lab alias remains.

Typecheck, integrated build and renamed embedded-helper self-test passed
(task_4e7a7016). Focused test initially checked async device close too early;
changed it to assert immediate status teardown then await cleanup, preserving
the existing async stop behavior. No runtime change needed for that assertion.

Running full suite task_5bd9e1d4 with SHELL=/bin/sh for test-owned commands,
log /tmp/die-native-live-full-tests.log. Running compiled isolated-home TUI
onboarding smoke task_656db4b9. No devices/provider/network auth calls intended.
Installed user binary still pre-promotion playback candidate until checks pass.

## Final review and validation

Read-only review task_55e2666c completed from worktree
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_55e2666c,
branch die/review-promoted-live-ux-and-lifecycle-55e2666c.
Two findings addressed:
- Pending-setup shutdown/session-change tests previously toggled off before
  exercising the named event. They now attempt explicit concurrent start and
  independently test toggle, stop, shutdown and session change.
- Linux releases do not bundle live-audio-linux. README and PRODUCT now
  explicitly scope bundled voice to macOS Apple Silicon. Old Linux SoX path
  is removed; native Linux remains source/developer-only. Delivering a normal
  Linux helper remains open. Do not claim Linux Live release readiness.
  No Linux acoustic investigation was resumed.

Final focused run task_f7097a86:163 pass,1 paid-provider skip,0 fail across22
files (21005 assertions). Includes Live runtime/auth/tools/packaging, installer,
release workflows and independent cancellation tests. Typecheck passed.
Compiled isolated-home onboarding AND argument-completion smoke passed.
Parent inspected actual tmux-rendered import/ready/completion screens: only
needed choices, no old subtitles or paid-test menu, no key rendered. Offline
fixture startup warnings about absent tools/models are not Live UI content.
No real keys, devices or provider calls were used. Native build and embedded
self-test passed; format and git diff --check passed.

Broad Mac run first had866 pass/18 skip/25 fail. Rerun used a canonical
TMPDIR (/private/var rather than symlink /var), child-only umask022 and
SHELL=/bin/sh:883 pass/18 skip/8 fail across909 tests. This corrects fixture
environment without changing host settings or weakening product guards.
Remaining8 failures are compiled self-update, one execute fixture using
/bin/true absent on macOS, and6 Linux-only lifecycle/ownership recorder cases.
Full result is NOT green. To distinguish regressions, parent built baseline
ffbccf3 in stopped worker worktree
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_d51c2ba5, using a local
node_modules symlink and reused web assets. The SAME8 tests failed on baseline
(65 pass/8 fail across4 affected files). First baseline attempt lacked dist/die
and had extra failures; only the built-baseline rerun is comparable.
Logs: /tmp/die-native-live-full-tests.log,
/tmp/die-native-live-full-canonical.log,
/tmp/die-live-baseline-build.log, /tmp/die-live-baseline-mac-built.log.
These are temporary local logs; counts and limits above are the durable proof.

Installation task_a578cbc7 uses existing staged verifier and atomic installer
with DIE_SKIP_BUILD=1, then installed --version/--live-self-test and hashes.
Check completion before reporting final installed checksum. Local version
remains0.9.1. No normal release/tag/push has happened; release remains separate.

Wisdom updated for new UX, helper paths, packaging, proof and Linux limit.
Values unchanged: existing minimal design, platform proof, clear limits and
safe ownership lessons already cover this work. Physical /live toggle and
speaker behavior after rename still need the user's next run.

Installation completed with exit0. Installed --version is0.9.1; embedded
--live-self-test/protocol v1 passed. Built and installed SHA256 match:
af2ed1f0e2b10477d90199c1c306ecc1d95e2537df6c3675f8a5f621995725e6.
Runtime source matches e8f4250; later commits only adjust tests/docs. User
should restart die and try /live twice. Normal release remains unpublished.
Temporary UI-review script/frames were deleted after inspection.
