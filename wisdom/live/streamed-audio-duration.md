# Streamed Live audio is not a retained-buffer budget (2026-09-26)

## Cause and fix

User reported frequent gpt-realtime-2.1 teardown with:
"Warning: Live stop requested: Provider invalid_audio: Voice turn audio limit exceeded. No agent work was cancelled."
This exact message was generated locally, not received from OpenAI. Both
OpenAIRealtimeSession and Gemini VoiceSession limited cumulative output to
96,000 * 24 = 2,304,000 bytes: 48 seconds of PCM16 mono at 24 kHz.
The counter counted even audio already played. Increasing that constant would
only postpone the same failure and would not measure retained memory.

OpenAI incremented bytes on each accepted output delta. interrupt() reset it.
A completed response reset it only when active, uncancelled and on the current
input revision. Tool-call response completion normally reset it before the
continuation; this is not universally a whole conversation accumulator.
But response.created did not reset it; failed/stale completions did not either.
speech_started advanced revision and suppressed old audio but only interrupted
(and reset bytes) if audioItems existed. A failed response after prior output
could leave old accounting for later output. Gemini reset its counter at
interruption and turnComplete. Even perfectly reset counters reject a legitimate
single reply longer than 48 seconds.

Remove those cumulative byte counters and their limits, not the protocol state.
Keep response/revision/call-ID ownership, completion callbacks, interruption
epochs, playback truncation metadata, transcript and tool bounds unchanged.
OpenAI audio item duration remains numeric truncation metadata, not PCM storage.
GPT-Live uses its own session/stream contract; it did not have this counter and
was not changed. Gemini and OpenAI packet validation remain separate.

## Real resource bounds and errors

Keep output packet size <=96,000 bytes, PCM16 alignment/nonempty checks, strict
base64 checks and Gemini MIME/rate checks. PlaybackScheduler still bounds unsent
PCM at 2,880,000 bytes (60 seconds), copies only accepted chunks, permits one
960-byte/20ms write in flight, and paces a shallow nominal 80ms native reserve.
Its pending budget measures what is retained, not how much a conversation has
generated. Native ring, flush gate, resampling, full-duplex capture and played
clock estimate are unchanged. Played time is not a physical DAC acknowledgement.
A producer outrunning a stalled consumer still fails visibly; no silent drop,
no unlimited queue, no automatic continuation pretending audio was complete.
An interruption clears the scheduler overflow latch and starts a new epoch;
the terminal extension currently stops voice on such an error and can be restarted.

The queue error now says "Local playback queue exceeds pending budget
(2880000 bytes); audio incomplete". The extension passes this scheduler-owned
safe message through instead of replacing every playback error with a vague
"failed or response exceeded" guess. Scheduler write/flush errors still use
fixed safe messages, not raw device exceptions. VoiceError remains {code,message};
malformed provider PCM still uses invalid_audio. No new error origin taxonomy
is needed to remove the spurious cumulative check.

## Warning evidence and work safety

src/live/extension.ts provider onError formats "Provider " + code (and OpenAI
message). fail() requests stop then calls ctx.ui.notify with severity warning,
prefix "Live stop requested: " and suffix ". No agent work was cancelled."
Installed dependency @earendil-works/pi-coding-agent 0.87.1 InteractiveMode
showExtensionNotify dispatches warning to showWarning; showWarning renders
Text(theme.fg("warning", "Warning: " + message), 1, 0). This explains the exact
reported leading "Warning:" too. Tests invoke that actual InteractiveMode
prototype and actual Container.render, strip terminal sequences, and assert
complete warnings for local queue overflow and genuine provider invalid PCM.
They assert owner.close runs, stopForeground does not, and audio closes.
Voice stop closes the voice owner and devices, not accepted agent jobs.

A deterministic end-to-end fixture uses real OpenAIRealtimeSession and the
extension with an injected socket/native device. 25 valid 96,000-byte packets
(50 seconds, below the 60-second queue bound) reproduced the exact original
warning against base c08e171's openai-session.ts. With the fix the same fixture
has no warning, voice remains active, and explicit stop returns jobsUnchanged.
This burst fixture is not an acoustic test or a claim about provider pacing.
Paced scheduler/session regressions separately cover draining streams.

## Workspaces and integration

Base c08e1714472a26a3bc4db92f03ea238366e996c9 includes the parent's newer banner.
Integration workspace: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_0e7084af.
Source/protocol reviewer: task_edf4af48, branch
 die/review-live-response-lifecycle-and-warni-edf4af48, workspace
 /home/tnfssc/.die/worktrees/die-a86675007a5e-task_0e7084af-a86675007a5e-task_edf4af48.
Regression worker: task_ed4c0d10, branch
 die/long-live-audio-regression-tests-ed4c0d10, workspace
 /home/tnfssc/.die/worktrees/die-a86675007a5e-task_0e7084af-a86675007a5e-task_ed4c0d10.
These are durable worktrees, not temporary release/code directories.

Potential overlap with clutter audit task_b9632b21: src/live/extension.ts changes
only the PlaybackScheduler onError callback (around line 163), and
 tests/live-extension.test.ts changes its overflow assertion/adds warning tests.
No banner, generic fail() warning wrapper, provider prefix, or VoiceError API
change. Preserve parent's c08e171 banner if audit base is older. Parent combines
reviewed commits; no publish, installed binary update, or release here.

## Values and limits

Reviewed values plus Live integration/playback-accounting and resource wisdom.
Existing values suffice: bound the growing queue rather than total useful work;
keep one buffer owner; preserve jobs; show real errors; don't add reset state to
solve an unnecessary counter. No values.md change needed.
All evidence here is offline deterministic protocol/UI/queue testing. No live
provider call, credential discovery, physical device, acoustic quality, Mac AEC,
or real network pacing validation is claimed. Canonical credentials were absent
in the parent's prior check; this patch does not need a key to reproduce the bug.

## Deterministic validation

Worker test commit 66d4872 was cherry-picked as 556d0af. Integration tightened
failed-response carryover to 47 seconds plus 2 seconds in the next response,
added real default-budget stalled playback and all OpenAI packet failure shapes,
and replaced the obsolete Gemini aggregate-limit expectation with packet guards.
Against c08e171 session sources, the final paced suite has 2 pass / 3 fail:
OpenAI 49-second reply, Gemini 49-second reply, and failed-response carryover
close with the old cap. Completed tool continuation already passes before the fix
because eligible completed responses reset the old counter; do not call that
path an established reset defect. After the fix all those cases pass.

Focused command:
 bun test tests/live-long-audio.test.ts tests/live-session.test.ts tests/live-playback.test.ts tests/openai-session.test.ts tests/live-extension.test.ts
Result: 140 pass, 0 fail (21,175 assertions). bun run check passes. The tests use
real schedulers with fake clocks and injected provider sockets, no network key.
The stalled sink test accepts 60 one-second packets with only one write in flight,
rejects packet 61 before retaining it, reports one truthful local error, and
clears the overflow latch only at a new interruption epoch.

An initial broader Live run hit four unrelated host-snapshot tests because the
shared OS temporary snapshot directory had exhausted its budget. No other task's
snapshots were deleted. Broad rerun uses a fresh isolated TMPDIR, a disposable
test artifact only, not a code/worktree location.

Broad rerun: env TMPDIR=/tmp/die-long-audio-tests-EZApG0 bun test tests/*live*.test.ts tests/openai-session*.test.ts
Result: 375 pass, 7 opt-in provider/native tests skipped, 0 fail across 54 files
(23,269 assertions). Includes the unchanged GPT-Live paths. Formatting and
 git diff --check pass. Dependency setup used bun install --frozen-lockfile;
this is workspace dependency setup, not installing/publishing the application.
