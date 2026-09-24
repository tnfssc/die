# Live voice waveform

User reports new prompt/transcript build works. They want the old animation
back, improved: voice should visibly speak. They called it a "baby pattern";
parent interprets that as braille/dot waveform, not a confirmed exact term.

History: 26ffd58 src/live/status.ts liveStatus rendered an amplitude-reactive
fixed horizontal line using thin/thick strokes in the die-live footer.
Native promotion kept footer plumbing but removed the reactive rendering.
Current src/ui/footer.ts already reserves die-live status; tests/footer.test.ts
covers width and Live visibility. Keep that compact surface, no new panel.

Implementation task task_bff4c96c, branch
 die/restore-polished-audio-reactive-live-wav-bff4c96c
worktree /Users/sharath/.die/worktrees/die-f528e86af6b5-task_bff4c96c.
Worker owns waveform module, extension wiring and focused tests. Parent owns
visual/terminal review, integration, broader tests and packaging/install.

Design intent: fixed-width smooth dot waveform, quiet listening state,
connecting distinction, mic/output activity from actual PCM not random motion.
Output visualization can follow scheduled PCM/queue, not claim measured hardware
amplitude. Native drain/interruption drive speech state. Do not alter audio graph,
playback pacing, transcript, tools, or prompt. Bound cadence and cleanup timers.

No changes installed yet. Values unchanged: existing honest state, minimal UI,
and real-path validation apply. Next: review worker result and test footer at
narrow and normal widths, silence/drain/interrupt/stop, then rebuild and install.

Worker merged as 6c2030f. Parent review found sustained peak output and stale mic
peaks could make meter sticky. Parent uses newest scheduled frame level and
clears each mic render window even during output. Speech-scale gain and broader
wave shape avoid a motionless row at ordinary levels. Added regressions.
Actual footer renderer checked with new braille strings: 60/90/140 columns show
full indicator; 1/10/24/40/60/90 column phase sweep stays one row and within width.
Footer deliberately collapses repeated spaces; test corrected for that.
No device/provider calls. Parent reviewed generated text frames, not Ghostty
physical appearance. Full tests task_82525517; build/helper task_51964a2a running.
Installed build unchanged until both pass.

Installed successfully via task_9e0d32a3. Dist/installed SHA256 both
`e073dddfb1280835dc149297f87f2dc7412f1d142e7f4e70d20e4af515da0507`.
192 Live/footer tests, typecheck, packaged helper self-test passed. Restart die
for physical Ghostty check: speaking motion, quiet decay, interruption, stop.
No acoustic changes or public release. Values unchanged; existing honest
state/minimal UI guidance applies.
