# Live footer waveform (2026-09-24)

Worktree: /Users/sharath/.die/worktrees/die-f528e86af6b5-task_bff4c96c

Old 26ffd58 status had a horizontal amplitude line. The current extension already owns the die-live footer status and native playback tail; keep that owner rather than add a panel. The new ten-cell braille meter samples PCM16 mic buffers and the scheduler's dispatched output frames. It is not a measurement of speaker hardware or what the listener hears. Playback scheduling and native queued depth are estimates, not audible acknowledgements. A short hold (at least 100 ms) lets a 12.5 fps footer see 20 ms playback frames; attack and release smooth the glyphs. Silence stays still. Speaking is still governed by the existing native drain; interruptions clear the output meter at once. Mic capture remains active during speaking.

One interval starts only after Live audio and playback start, stops on stop/failure/session switch; an earlier connecting state is static. Transcript widget and audio graph are unchanged. Footer owns terminal width clipping. Tests use fake audio and direct renderer checks; no physical device, provider or packaged terminal visual check was done. Parent should inspect actual terminal appearance and package behavior.
