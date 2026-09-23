# CLI Gemini Live concurrent-loop prototype

Post-v0.7.0 platform correction: see [macOS local audio](macos-local-audio.md). Linux-only statements below describe the original implementation; pending support now includes local macOS with Homebrew SoX. SSH/web exclusions and physical-acceptance gaps remain.


## Workspace and ownership

- Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4b3cd724
- Branch: die/prototype-concurrent-gemini-voice-and-di-4b3cd724
- Prior stopped worktree task_9334a390 was inspected read-only: clean, at b0fdd55; no useful uncommitted changes to transplant. Never overwritten.
- Research: task_19dc2b4f / branch die/research-gemini-live-official-protocol-19dc2b4f (path below).
- Bridge: task_a31facb9 / branch die/current-session-live-bridge-a31facb9; lifecycle correction task_7f2e4943 / branch die/fix-bridge-lifecycle-evidence-7f2e4943.
- Audio: task_e3c622e1 / branch die/local-audio-adapter-e3c622e1.
- Research path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4b3cd724-a86675007a5e-task_19dc2b4f
- Initial bridge path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4b3cd724-a86675007a5e-task_a31facb9
- Bridge correction path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4b3cd724-a86675007a5e-task_7f2e4943
- Audio path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4b3cd724-a86675007a5e-task_e3c622e1

## Approved architecture implemented

This is **live talk**, not dictation followed by read-aloud. One Google Live websocket continuously receives local microphone PCM and produces speaker PCM. Separately, the existing configured die session receives bounded asynchronous followups through Pi's sendUserMessage with deliverAs=followUp, expandPromptTemplates=false. There is no new agent session/model/auth selection, subprocess coding agent, independent voice-owned tool executor, permission override, web integration, or SSH forwarding.

The Live tool handoff is NON_BLOCKING. It immediately receives only a queued acknowledgement, then generator-style function responses carry confirmed session observations. The most recent handoff remains an observation channel so later background-agent resumptions can be heard too. Observations are explicitly scoped to the **whole current session**, not falsely attributed to the latest request. Tool metadata has no arguments/raw output; assistant text is bounded to 4000 characters with truncation marked. Private thinking is excluded. Tool finished / turn ended / run ended never mean that background work completed.

Input-hook observation is preflight, not proof of delivery. Actual user message_end content establishes acceptance/correlation. Requests carry a small [Live request ID] prefix so matching ordinary typed text cannot accidentally claim the handoff. A later unrelated user delivery ends only the old association, not work; the independent current-session observer still reports confirmed progress. Asynchronous sendUserMessage rejection is handled without awaiting the agent. Source evidence: pinned Pi 0.87.1 AgentSession.sendUserMessage delegates to prompt, whose input hooks precede followup queuing; its Promise can encompass a whole agent run. Integration tests keep that Promise pending while exercising both audio directions.

Google function response scheduling and willContinue use canonical top-level fields from REST FunctionResponse / SDK declarations, not the contradictory nested scheduling example in the guide. Ordinary progress uses SILENT, completed assistant text WHEN_IDLE. No blocking wait for tools occurs in audio callbacks. Research used tvly on official Google pages; current documented stable model is gemini-3.8-live. See gemini-live-research.md.

## User controls

- /live opens a small existing terminal select UI; /live setup explains requirements/limits.
- /live start is the explicit paid connection + microphone start control. There is no autostart, automatic reconnect, startup key read, or automatic device recording during setup/help.
- /live stop closes only socket/audio/reporting. Existing agent work and jobs continue.
- Speech interruption immediately discards playback and replaces only the player. Recording and agent work continue.
- /live cancel-work separately confirms aborting the configured agent's current turn. Queued followups and background jobs may continue; jobs.stop remains their existing cancellation authority.
- UI is a fixed-width horizontal PCM-amplitude line via die-live in the existing compact footer, not an orb/panel/new screen. Detailed /status preserves existing behavior.

## Credentials and local devices

The only temporary credential source is user-owned ~/.die/live.env, exact mode 0600, regular file, no symlink, <=16 KiB. Parser accepts one literal GEMINI_API_KEY assignment and never evaluates shell or mutates process.env. Errors never include source, key, raw socket URL, or raw server errors. The real key was not printed, copied into the repository, or loaded during tests. live.env is ignored in git as defense in depth.

Existing auth storage schema was investigated, not overwritten. Eventual terminal key setup should use existing google provider credential storage/ModelRuntime, preserving other providers and OAuth; do not invent another persistent auth schema. Current setup menu is informational, **not** a completed credential editor/migration.

Audio slice targets Linux with SoX rec/play and working default audio devices. Commands are arrays, no shell. PCM16 mono LE input16k/output24k. Persistent streaming children, bounded playback (96 KB queue plus bounded writable buffering), 512 KB websocket backpressure threshold, 2 MB inbound frame cap, bounded handoff/recent-ID tracking. Overflow fails visibly and closes audio instead of silently dropping speech. Stop/session replacement/error detach listeners, timers, socket, and owned processes; pending startup cannot open a mic after stop. Raw SoX processes are killed immediately on teardown (no persistent files to flush).

## Honest limits / next steps

- All validation is offline: synthetic PCM, fake sockets/processes, fake extension events and source/API inspection. **No paid Live connection, mic capture, actual speaker playback, latency/quality, account model access, or wire acceptance test has run.** Explicit user /live start is the next acceptance test.
- SoX executable presence is preflighted, but actual device availability is only known at explicit start. Linux only; no device selector or echo cancellation. Headphones or an OS echo-cancelled default device are recommended; ordinary open speakers may feed back.
- A cancelled Live function-response channel cannot be reused; coding keeps running. If all channels are cancelled, progress remains in the terminal until a new voice handoff provides a response channel. No hidden retries/replay of side effects.
- No transcript persistence for casual speech, session resumption/reconnect, initial session-history export to Google, or automatic result summarizer. Only selected current-session confirmed events are shared after a handoff. Voice model truthfulness is instructed and supplied grounded events, not a guarantee against all model hallucination.
- Finite provider sessions and goAway close audio with a visible message; user explicitly restarts. Agent continues.
- Followup input can be transformed/handled by other installed extensions; absence of a matching delivered user message is never called acceptance. It remains bounded/unconfirmed rather than guessing.
- Next: opt-in real local audio acceptance; verify barge-in/acoustic echo behavior and raw NON_BLOCKING generator protocol against account; then terminal credential/device setup using existing auth, not expanded scope before evidence.

## Validation

Validated with Bun 1.4.1:

- 50 targeted tests across 8 files (live bridge/transport/credentials/controller/status, audio, footer), all passed; includes pending-agent duplex audio, background resumption, repeated handoffs, interruption, async delivery rejection, credential privacy, late audio errors and shutdown races.
- 35 regression tests across compiled CLI, subagent extension, last-used CLI model and prompt delivery, all passed.
- bun run check (whole-repository TypeScript) passed.
- Standalone CLI compilation and isolated-HOME --help smoke passed.
- Changed-file Biome formatting and git diff --check passed; lint has existing-style warnings/info, no errors.
- Full repository/web suite was not run.

 CLI compile reuses the unchanged existing main-worktree dist/die-web.archive.gz as a build asset; no web code/build change is claimed. Initial direct compile correctly failed before that generated asset existed.

Values unchanged: this work applies existing truthful state, bounded resources, user-work safety, and simple ownership principles; it adds feature-specific evidence rather than a new general value.

## Parent integration review

Fast-forwarded into main workspace at 6e972dd. Read-only review task_b487b77e found no blockers and passed 47 tests. Parent separately passed 50 tests and typecheck; shell emitted a mise trust warning but commands completed exit 0 without changing trust. Local rec/play executables exist; devices remain untested. No live paid session or mic recording run. Installed die binary is not rebuilt by this merge. Source prototype is ready for opt-in acceptance, not a verified release.

## Automated real-provider acceptance (2026-09-23)

A real, opt-in Gemini Live wire acceptance now exists at `tests/live-provider.acceptance.test.ts`. It is skipped in ordinary test runs and makes a paid call only when `DIE_RUN_GEMINI_LIVE_ACCEPTANCE=1` is explicitly set. It uses local espeak-ng and SoX to generate PCM16 mono 16 kHz speech, never opens recording/playback devices, has one 30-second session deadline, makes no retries, and prints only bounded boolean/byte-count evidence.

Real provider result with `gemini-3.8-live`:

- setup was accepted;
- Google returned a nonempty input-audio transcription and 12 model-audio packets (96,004 decoded PCM bytes), proving synthetic speech input and model audio output rather than silence alone;
- after audio acceptance, a finite text turn deterministically requested `handoff`; Google emitted the declared NON_BLOCKING function call with a nonempty request;
- The harness sent continuing `toolResponse.functionResponses` (`willContinue: true`, SILENT then WHEN_IDLE) and a final response (`willContinue: false`). Audio arrived after a continuing response with no observed protocol error. The harness ends after sending the final response; it does not independently prove the final response was processed or its content spoken;
- a provider `interrupted` signal was observed when the follow-up turn overlapped model output. This validates interruption signaling/clearing on the real wire, but does **not** isolate synthetic-speech barge-in or acoustic echo behavior.

The first two diagnostic sessions accepted setup but produced no turn; adding an explicit finite-stream `audioStreamEnd` still did not produce a turn. A third session with input transcription, leading/trailing silence, real-time pacing, and stronger locally synthesized speech proved audio input/output. The final short acceptance session (5.25 seconds) proved the complete audio + tool-response path. There were four bounded sessions total and no retry loop.

Concrete fixes from acceptance:

- credential parsing now accepts dots used by the private key format while retaining strict literal-only parsing and opaque errors;
- finite synthetic streams can send `audioStreamEnd`;
- setup requests input audio transcription and the adapter exposes it only to an optional in-memory callback;
- the harness can send a finite text turn after independently proving real audio acceptance, making tool-schema acceptance deterministic without claiming speech caused the tool call.

Remaining gaps: no physical microphone/speaker or normal `/live start` path was used; no acoustic quality, device, echo-cancellation, or synthetic-speech-only barge-in test was performed. The existing fake-device/controller tests remain the evidence for actual extension/session wiring; this acceptance is real-provider transport evidence and uses a fake configured-agent response bridge.

Parent integrated acceptance commit 6db75c6 from /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8d34cd24 (branch die/automated-real-gemini-live-acceptance-8d34cd24). Tightened evidence wording: sent is not server-processed; final-response semantics and continued conversation during a long real coding job still need stronger acceptance assertions. Values unchanged; existing “show what is real” covers this lesson.

## Safety setting request in progress

User requests least restrictive supported Gemini safety thresholds. task_3e323a91 checks official Live schema before changing anything. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3e323a91, branch die/configure-supported-gemini-live-safety-t-3e323a91. Do not assume generateContent safetySettings are accepted by Live. Mandatory provider protections and die permissions unchanged. Completed: official Live schema has no documented safetySettings field; runtime unchanged. Merged 3cece86 research and regression tests; parent confirmed 5 tests pass. See gemini-live-safety-settings.md.

## Onboarding replacement awaiting parent review

See [CLI Live onboarding](cli-live-onboarding.md) for the terminal wizard, canonical provider-auth import/reuse, explicit setup-only paid test, and offline lifecycle evidence. That feature supersedes the informational-only setup and live.env direct-start credential path described above. It preserves the configured-agent/concurrent-loop architecture and compact status line. Parent review is required before merge.
