# Live: one native runtime, direct entry

Worktree: /Users/sharath/.die/worktrees/die-f528e86af6b5-task_b59c92bf
Branch: die/promote-live-with-direct-entry-and-minim-b59c92bf
Runtime slice; parent integrates packaging and reviews the whole terminal experience.

## User contract

The user says bare /live should enter voice. The explicit command authorizes that session; a second Start confirmation and an action picker add no authority. /live and /live start now start directly with configured Google API-key auth. No persistent consent flag exists.

/live setup is configuration only. Existing auth offers Start voice / Done; choosing Start voice is the explicit start action. Missing auth gives secure-file instructions, Import ~/.die/live.env only when the file exists, Recheck, and Cancel. Import itself is the explicit migration action; it never starts voice. Cancel/dismiss stays offline. OAuth is preserved and cannot be imported over. No ordinary input or transcript receives secrets. The existing credentials.ts and its conditional locked CredentialStore.modify migration are unchanged.

Auth is resolved before launching a helper so missing-key direct entry can route into setup without touching audio. After auth, the established native sequence remains helper hello -> provider accepted -> native start -> playback scheduler start. Setup metadata inspection creates ModelRuntime with network refresh disabled; no provider connection or devices. Pending auth/setup has one abort owner. Stop, shutdown, or session change invalidate late key/dialog/import results; none may revive voice.

The footer says only Live connecting/listening/speaking. No model/banner subtitle and no successful-start toast. The configured agent and six tools remain unchanged. Explicit diagnostic consent remains for mic-check and speaker-check. Status and --live-self-test remain diagnostic entry points, not a top-level menu. Speaker evidence is bounded and does not claim proof of barge-in/AEC.

## What moved and what was removed

The working native runtime moved from src/live-lab to src/live; no wrappers/aliases. Public identities: liveExtension, LiveDependencies, LiveAudio, die-live, die:live:host-access. Helpers resolve live-audio/live-audio-linux. Audio subprocess environment now allows LIVE_SOURCE/LIVE_SINK rather than LIVE_LAB_SOURCE/LIVE_LAB_SINK; packaging/native source must use these same names.

The old SoX audio, custom transport, bridge, paid connection-test, setup maze, and reactive-line implementation are gone. Their implementation-only tests (including tests/audio.test.ts) are retired. Native tests use live-* names. Credential, privacy, provider opt-in and lifecycle coverage remains. Existing live-dispatch-budget helpers/tests concern configured-agent provider smoke dispatch, not the deleted voice transport, so they remain unchanged.

No DSP, protocol, startup graph, scheduler reserve, fractional tails, full-duplex capture, orchestration authorization, or host cancellation authority was redesigned. Credentials source is unchanged. Tasks extension only changes the two host imports. Bare-command tests reject any select/confirm call. Setup tests cover missing key, explicit import, OAuth preservation, errors without secret text, cancelled inspection/import/dialog and configured-key explicit start. Extension tests cover missing-key direct entry, setup-to-start, concurrent entry, stop/shutdown/session-change cancellation and fresh restart.

Provider acceptance is still opt-in via DIE_RUN_GEMINI_LIVE_ACCEPTANCE=1. It now checks the official SDK setup with actual tool declarations and inert tool execution, using canonical credential service. It does not run the obsolete SoX synthetic-speech/handoff protocol. It proves setup only, not spoken tool calls or acoustics. It was skipped here.

## Verification and integration gaps

- Frozen-lockfile dependency install and prepare:assets succeeded. No lockfile change.
- Runtime plus host/job suite: 151 passed, 1 paid-provider skip, 0 failures across 19 files (20,789 assertions). After the final file-aware setup-copy refinement, setup/entry rerun passed 35 tests; the added existing-file-copy assertions passed the 7-test setup suite. Tests use fake SDK/audio, temporary fake credentials, and test-owned harmless local jobs. No device/provider call, real key import, application install, build/release, or user-job mutation was performed.
- Changed-file formatting and git diff --check passed.
- Whole-tree tsc currently reports only packaging-owned old paths: scripts/live-lab-acceptance.ts, src/cli.ts, and tests/live-lab-{embedded-helper,platform,setup-diagnostics}.test.ts. No runtime-owned TypeScript errors. Parent must rerun after packaging integration.
- Parent/packaging must update scripts/live-onboarding-smoke.ts old wizard labels and obsolete import confirmation, tests/release-workflows.test.ts lab references, the CLI's single factory/self-test flag, native paths/env names, scripts and build plugins. No old-path alias is provided.
- Physical terminal, current packaged binary, native compilation, actual provider and microphone/speaker acceptance remain untested here. Earlier user success with native Lab motivates preserving that machinery; offline tests cannot prove the promoted physical experience.

Related evidence: live-lab-orchestration.md, live-lab-mac-startup-diagnostics.md, live-lab-playback.md, cli-live-onboarding.md. This note supersedes their old entry names and extra confirmation/menu UX, not their runtime safety lessons.

Values unchanged: finish the real flow, explicit authority, one lifecycle owner, preserve credentials/work, and honest proof already cover this change. Do not add a consent preference to solve a redundant-dialog problem.
