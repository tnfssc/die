# Realtime frequent audio-limit stops

User frequently sees "Live stop requested: Provider invalid_audio: Voice
turn audio limit exceeded. No agent work was cancelled." on gpt-realtime-2.1.
Source has local 48s total turn cap (96000*24 bytes /48000 bytes per second).
Gemini shares equivalent cap; playback independently bounds queued audio.
Need verify lifecycle accounting and fix long normal replies without
removing real memory/packet bounds. Provider attribution is misleading for
local cap. Parent explained source finding, not claimed full cause verified.

Worker task_0e7084af:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_0e7084af
branch die/fix-realtime-audio-cap-stopping-live-0e7084af
base c08e1714472a26a3bc4db92f03ea238366e996c9.
Broad surface audit task_b9632b21 also active; error UI/extension overlap
possible. Parent integrates both and banner fix. No push/release/install
yet. Test >48s paced audio, multiple response states, malformed input,
stalled queue bounds and no agent-work cancellation on voice teardown.
Values already cover resource bounds and truthful errors; recheck after
findings without inventing another blanket limit.

Worker returned556d0af/08f5bc6, integrated c99540a/9ffd14a.
Parent read implementation: removes cumulative generated-duration counters
from Realtime/Gemini, preserves per-packet validation and 60s pending
queue/native bounds. Queue overflow now labeled Local playback queue.
Playback error strings are local controlled literals. Parent typecheck
and focused audio/adapter tests pass (artifacts/long-audio-parent.log).
Worker proof375 pass/7 opt-in skips; no paid/device acceptance.
Broad audit and speech-retention work still pending; no release yet.

Parent combined full gate passed1194 tests/17 opt-in skips/zero failures.
Fresh CLI/web build, web suites, typecheck/format/lint/smoke pass. See
surface-clutter-audit.md for scope and limits. Not pushed/released yet.
