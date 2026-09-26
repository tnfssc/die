# GPT-Live crackling report

User hears a lot of crackling while speaking with GPT-Live 1 after v0.14.0.
Parent asked: in its replies? only during user speech, or also silence?
Answer pending. Do not assume echo or blame device without evidence.

Audio investigation job task_31e38b23:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_31e38b23
branch die/investigate-gpt-live-audio-crackling-31e38b23
base 1f4e096628ce5222d8ae793bbcb6ccf783f4a0a1.
Check wire PCM, buffering, playback recovery and mic/full-duplex behavior.
Reproduce with audio fixtures and native helper tests; paid/device tests
remain unverified if canonical key/device unavailable. No publish/install
authorized for this follow-up yet.

Separate transcript UI fix task_3d13e60c may overlap extension.ts. Parent
integrates both and reviews real evidence, not only mocks. Existing
whole-path proof and honest-evidence values apply. Revisit after findings.

User clarified: crackling is in spoken replies and happens randomly.
Saved clarification in audio worker tree wisdom/live/crackling-user-clarification.md.
Transcript fix separately integrated 2af554c/867954c/1a7a3fa; parent
reran typecheck and real PTY test, pass. No release or install yet.

Audio investigation completed. Proven shared native interpolation seam
bug fixed; integrated 82cacb0/a53cb01/2b58227. Parent reran native core
and waveform tests with ASan/UBSan: pass, waveform mismatches zero.
Before had 49 mismatched samples per one-second fixture. This proves a
defect, not that it explains the user device crackling. No paid/device
acceptance. Transcript fix is also local. No push/release/install yet.
Feature investigation note has full evidence; values unchanged because
existing evidence-vs-inference and shared-path safety guidance applies.
