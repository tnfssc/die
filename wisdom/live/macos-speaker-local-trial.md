# Mac speaker trial: local handoff

2026-09-24. Pulled origin develop with --ff-only before work. HEAD stayed
26ffd58d90806263bf7ed14f3590f6fcc7c90680 (v0.9.1 evidence). Main workspace:
/Users/sharath/Private/home/Code/die, branch develop. Host reports arm64,
macOS 26.6.2 (25G83). No audio devices opened, provider calls made, or
microphone recordings taken by this investigation yet. No runtime patch.

Read the prior speaker research, reference audit, Telegram source trail,
September investigation, startup diagnostics, and orchestration notes.
Keep the working startup graph and full-duplex capture. Nine channels is a
clue, not a proven bug. The synthetic speaker check is not speech proof.

## Delegated research (failed)

- Capture channel/source research: task_3467b36a. Worktree
  /Users/sharath/.die/worktrees/die-f528e86af6b5-task_3467b36a;
  branch die/trace-mac-capture-channels-3467b36a.
- Cutoff diagnostic path research: task_c6e166f5. Worktree
  /Users/sharath/.die/worktrees/die-f528e86af6b5-task_c6e166f5;
  branch die/trace-live-cutoff-evidence-c6e166f5.

Both agents failed with model-provider HTTP 402 (insufficient funds), without
completed findings. Their process exit code 0 did not mean success. No agent
findings have been integrated. The stopped Linux worktree is not used.

## Next evidence

Asked user to start /live-lab in Ghostty with built-in mic and speakers,
request a few sentences, stay quiet, and paste /live-lab status immediately
after the cutoff, before stopping, plus any error. Current status reports
provider interruptions while the session is alive; stop loses this view.
An interruption identifies server cancellation, not its acoustic cause.

Also asked for explicit consent to a short local processed-mic recording
during real reply playback. User approved with “do whatever you want okay.” Scope explained back: short
local recording/live trial, private, out of Git, deleted after inspection.
No system audio setting changes or mic muting. It may contain room speech. Keep any approved recording out of Git and
delete after inspection. A recording path/tool still needs to be chosen;
current speaker-check does not validate actual reply echo or double-talk.

Need speaker echo-only, natural user interruption, headset control, and
startup validation before claiming a fix. No release planned from current
evidence. Use normal release workflow and die update once grounded and tested.

Values unchanged. Existing real-device proof, clear evidence limits, and
user privacy values cover this work.

## Local checks after consent

- bun install --frozen-lockfile succeeded (Bun 1.4.2). Lockfile unchanged.
- sh scripts/build-live-lab-helper.sh succeeded, including device-free
  self-test. Helper is dist/live-lab-audio. No acoustic proof.
- system_profiler SPAudioDataType reports default MacBook Pro Microphone,
  one input channel at 48000 Hz; default MacBook Pro Speakers, two output
  channels at 48000 Hz. ZoomAudioDevice exists but is not default.
  This is a system snapshot, not an observation of the active helper route.
- Current input tap in native/live-lab/main.swift requests inputFormat and
  forwards buffer.floatChannelData?[0] to the capture ring, then converts
  to mono PCM16 16 kHz. No mix of all nine channels is sent.
- Local Apple SDK AVAudioIONode.h documents that enabling voice processing
  on either I/O node enables it on both. It does not assign documented
  meanings to the nine channels. Do not infer channel 0 is wrong or correct.
- Command runner reports stdin.isTTY=false and no SSH variables. The existing
  LiveLabAudio.launch guard rejects noninteractive device startup. Did not
  inject a test worker, fake TTY, or launch the helper directly to bypass it.
  User was asked to run real speech in Ghostty and return status immediately
  after cutoff. No microphone audio has been recorded yet.

Next: collect that session evidence before choosing a diagnostic recorder or
changing the graph. No speculative fix or release. Runtime source unchanged.

## Local installation requested

User asked to install the current work. Explained that runtime is unchanged
v0.9.1, not an echo fix. bun run install:local built and installed to
/Users/sharath/.local/bin/die, but post-install --live-lab-self-test failed:
"This build has no embedded native helper for this platform". Default build
omits the release helper plugin. Do not treat installer exit 0 as voice proof.

Correction launched as task_78f8f6ff: bun run build -- --reuse-web
--live-lab-helper=./dist/live-lab-audio, then built helper self-test, then
DIE_SKIP_BUILD=1 sh scripts/install-local.sh, installed --version and
--live-lab-self-test. Check completion before claiming successful install.
Release workflow uses this same explicit helper build option. No runtime
source changed; the default local installer packaging gap remains to fix
separately. Values unchanged: test the installed thing already covers this.

Correction completed with exit 0. Both built and installed embedded-helper
self-test/protocol v1 checks passed (no devices). Installed --version is
0.9.1. User can restart die; acoustic diagnosis still awaits real speech.

## Physical reply and crackling follow-up

User reports no errors and apparently completed speech, but crackling sound.
Pasted status: listening, input494 frames, output3160ms, queued0ms, turns1,
provider interruptions0, VP enabled/unbypassed. User said “Hey, how are you
doing?” and model answered “I'm doing great, thanks for asking! How can I
help you today?” This turn has no reported server interruption. It is not
long-reply/double-talk acceptance and does not establish that echo is fixed.
Asked whether crackling occurs throughout or at edges, and whether other
Mac audio is affected. Answer pending.

Parent device-free probe of current PlaybackScheduler: enqueue 200 20ms
frames, model continuous consumption and each timer firing 2ms late (22ms
steps). After100 steps: elapsed2200ms, supplied2020ms, empty200ms,
pending1980ms. No native feedback was simulated. nextSendAt=now+20 forces
repeated gaps with no reserve despite available PCM. This proves a scheduler
weakness under that timing model, not the cause of physical crackling.

New workers use fast profile (different configured provider from failed
normal workers):
- Native renderer audit task_a5b5f227. Worktree
  /Users/sharath/.die/worktrees/die-f528e86af6b5-task_a5b5f227;
  branch die/audit-native-playback-crackle-a5b5f227. Research only.
- Bounded playback cushion candidate task_7e23c00d. Worktree
  /Users/sharath/.die/worktrees/die-f528e86af6b5-task_7e23c00d;
  branch die/fix-bounded-playback-cushion-7e23c00d. Owns TS scheduler/tests.
  Must test delayed timers, block rendering, stale feedback, queue bounds,
  full tails, serialized writes and prompt interruption. No device calls,
  installation or release. Review and integrate before any user trial.

Main runtime and installed binary remain unchanged v0.9.1. Values unchanged:
existing evidence limits and whole-path validation apply.

## Native audit and combined timing probe

Native audit task_a5b5f227 completed without edits. Existing C tests passed.
It reproduced two boundaries: (1) 480 constant input samples rendered into
1024 output samples at48k produces960 nonzero then64 zero samples, without
error; (2) interpolation lookahead that ran dry holds the last sample even
if next chunk arrives before held-tail rendering. For source
[0,10000,20000,30000], all-at-once at48k yields
[0,5000,10000,15000,20000,25000,30000,30000]; pushing two samples, rendering
two output samples, then pushing two yields
[0,5000,10000,10000,20000,25000,30000,30000]. This is a real boundary
continuity defect, not proof of this user's audible cause. No native fix
chosen yet. Worker also noted an untested concurrent flush/pull generation
race; keep separate from uninterrupted crackling, do not expand scope blindly.

Parent combined the actual PlaybackScheduler with real AudioCore.c via
Bun FFI (clang -dynamiclib). Deterministic simulation:4s constant PCM already
queued;512-frame render quantum at48k; every JS timer2ms late; no native played
feedback. Over2200ms:9472 zero output frames (197.33ms), max C queued20ms,
1980ms still pending in JS, zero errors. This confirms starvation reaches
the actual C renderer under that model. It does not measure the Mac device.
Probe source and dylib are disposable at
/var/folders/bf/b99kjy314x36r9t_6ffs0d2m0000gn/T/die-render-probe-4lCsyE.
Re-run its probe.ts with absolute candidate playback.ts path when worker
finishes. Delete probe files after comparison; keep durable regression tests.

## Playback candidate integration

Worker commit24cc469 integrated as2b42641 on main workspace branch
fix/live-playback-cushion. Only scheduler behavior changed: serialized
refill of60–80ms reserve; low native reports cannot erase write credit.
Capture, provider VAD, graph and native sources unchanged. Worker tests
proved delayed-timer baseline fails, candidate passes;30 focused tests passed.
Main integration has dependencies and is running all live-lab/live-host tests
plus typecheck (task_10d6abc8). Formatted/organized changed test imports.

Parent re-ran the SAME actual C renderer/TS scheduler probe against candidate:
2202ms simulated,105472 rendered frames, ZERO inserted zeros, peak C queue88ms,
1720ms pending, zero errors. Baseline had197.33ms zeros. Native quantum can
make actual depth exceed wall-clock reserve by one block;88ms remains far
below1s ring. This is independent device-free evidence, not an audible pass.

Remaining: finish integration tests/typecheck, build with explicit embedded
helper option, self-test, install approved local candidate, ask user for quiet
long-reply/crackle, natural interruption, and headphone control. No stable
release or echo-fixed claim yet. Local version remains0.9.1 despite candidate
source commit; tell user it is a local candidate, not a new release.

Integration first run:101 pass,1 fail. The failure expected one immediate
20ms frame in extension startup; candidate intentionally sends four (80ms).
Updated that assertion and added explicit zero writes before native ready.
Rerun task_9b258ec6 includes all Live tests and typecheck. Candidate packaged
build and embedded-helper self-test passed (task_d5e31776); not installed yet.

## Candidate installed for physical trial

Integration rerun passed102 tests across14 files (20573 assertions), and
bun run check passed. Changed TS files pass Biome format and git diff --check.
Candidate build task_d5e31776 passed embedded-helper self-test. Runtime source
is2b42641; follow-up tests/evidence committed ind4268de on
fix/live-playback-cushion. No source change after build affects runtime.

Installed via DIE_SKIP_BUILD=1 sh scripts/install-local.sh. Installed version
still0.9.1 (local candidate, not a published release). Installed helper
self-test/protocol v1 passed. Built and installed CLI SHA256 both:
c2ff60af0a9dff52aebf98dfd1a9db777de34c0448b6139c25f177b380ff29f7.

Ask user to restart die, request a20-second reply and stay quiet, report
crackle/finish and status, then test saying “stop” during another reply.
Headphone control and native startup must still work. No provider/mic
recordings were taken by agent; no audio files need deletion. Temporary
FFI probe is removed after saving numeric evidence above. Physical quality
still pending; native held-tail boundary issue remains separate, unpatched.
Wisdom updated; values unchanged because real-path proof and bounded-use
values already cover the lesson. No release or remote push done.
