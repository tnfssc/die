# Shared session host boundary

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_054bb11a-a86675007a5e-task_803961bd
Branch: die/shared-session-host-boundary-803961bd

The tasks extension remains the sole owner of JobService and TaskManager. Shared `src/session/host.ts` owns session/branch checks, bounded request replay, trusted send and cancellation confirmation, snapshot persistence and watchers. It only sees an explicit `SessionTaskPort`: scoped list/inspect/stop, local job summaries, and task updates. The adapter in `src/tasks/extension.ts` calls the existing service with the same context, signal and inspect limit. Do not add a second task scheduler to a voice client.

The event-bus access key now names the shared session; only the tasks extension registers the host. The host survives voice reconnects until owning session shutdown. Tests exercise real extension access, adapter-backed TaskManager/JobService calls, and an isolated port proving confirmation and session scope prevent stop dispatch. Transcript custom-entry and snapshot payload formats are unchanged. The shared host temporarily imports `../live/transcript` only for `VOICE_ENTRY` and `TranscriptEntry`; parent owns moving those definitions into shared conversation code and must update this import during integration. The delegation prompt still names GPT-Live, because provider behavior/prompt is out of scope.

Snapshot tests share a real per-UID temp budget; on a machine with retained files, run them under a fresh `TMPDIR`. Do not clear another session's snapshot store to make tests pass. No values change: existing single-owner, bounded-resource and truthful-handoff values cover this boundary.
