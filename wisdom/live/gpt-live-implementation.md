# GPT-Live implementation and parent-review handoff (2026-09-24)

## Status

Actual gpt-live-1 primary WebSocket support is implemented on selection milestone8473682, not another research gate. Persisted selection constructs GPTLiveSession, not Realtime/Gemini or an extra Responses/coding agent. Native PCM, contextual delegation and extension lifecycle are wired. Parent review rejected the initial strict mute-until-restart policy. It is now replaced by practical automatic local recovery (qualified detector end plus200ms captured-quiet guard) with explicit stale-tail uncertainty. Await parent review before publication; no paid/device or perfect-barge-in parity claim.

Read wisdom/values.md, selection research, and focused review via git diff 8473682...die/resolve-gpt-live-delegation-and-playback-ee3013ae -- wisdom (review branch d866c77). Fetch origin/develop succeeded; 44ff46f (v0.9.2 publication evidence) is already an ancestor. Merge reported already up to date. Package stays0.9.2; no release/workflow edits.

## Wire and lifecycle

src/live/gpt-live-session.ts opens wss://api.openai.com/v1/live/sessions with Bearer key and no model query. Exact session.start startup model/audio/delegation; wait for session.started before opening devices. Processed native PCM16LE mono16k is continuously resampled to24k with the unchanged existing resampler, then session.input_audio.append.audio. session.output_audio.delta.delta feeds bounded paced playback. No mic gating on output, detector, or agent work.

Transcript deltas retain documented start/end offsets. No invented transcript-done, speech_started, response ID, truncate or old/new epoch. User fragments save as partial, never invoke completed-ASR orchestration or increment completed-input counters. Client session.delegation.created reads delegation.id/target and offset_ms; no task text/tool args fabricated. Scoped commentary.append/thinking.append use original delegation ID. General observations use documented nullable ID, never fabricated request attribution.

Graceful stop sends session.close with15s session.closed deadline. Abrupt loss/timeout does not claim finalized usage. Connect timeout, malformed events/PCM, socket backpressure, callback errors and close-during-connect fail boundedly. Closed callbacks cannot revive old runs. Shared sanitized quota/rate/model/key classification extracted into openai-errors.ts preserves Realtime behavior; no substitution or raw provider messages. Outbound updates cap UTF-8 bytes at480 conservatively below500-token limit without a tokenizer.

Official source URLs/schema evidence: [wire note](gpt-live-wire.md), [VAD review](gpt-live-vad-review.md). Independent reviewer391e7471 found no fatal wire-schema mismatch in the integrated adapter.

## Snapshot and authority

GptLiveDelegationBridge is separate from VoiceOrchestration.execute. Saves <=32 fragments/6KB plus <=16 bounded host-context snapshots (3800 chars each). Context is observed at session start0 and on host updates; delayed delegation selects a saved context at/before its offset, not a later fresh context. Local capture-clock alignment is approximate and labeled contextClock=local-capture-approximate. Fragments ending after offset are excluded; overlap, late correction and omission remain uncertain. No offset proves final speech. Revisions cover fragment/context changes. IDs dedupe in a non-evicting256/session ledger. Missing retained context fails instead of using future state.

LiveHostBridge.delegate queues quoted provisional snapshot to the **existing configured agent**, with its existing followUp delivery, scope and permissions. It does not use the authoritative-final-speech template or launch another coding agent. Normal agent-message persistence saves the snapshot. Host context supplies bounded conversation, jobs and prior request ledger. Branch advancement during queued delivery and host-session changes invalidate dispatch. Clarification for ambiguous/irreversible work is an explicit instruction to that configured agent, not a claim of exact-ASR authorization.

Cancellation is also enforced: after a delegation is queued, the tasks extension's jobs.stop dispatch passes confirmDelegatedAgentStop and the existing trusted confirmStop(exactId) UI. Since later tool origin is not reliable, confirmation conservatively persists for this host session, even after voice disconnects. Existing direct voice host.stop still confirms separately. This grants no new tools/permissions and is not a sandbox against arbitrary shell code; configured-agent shell permissions remain unchanged.

Backend jobs survive interruption/voice closure. Both success and failure dispatch results are suppressed on stale epoch/revision/closure. Speakable scoped results are fixed verified dispatch/clarification status; queued is not completed. Raw assistant/job observations are silent thinking data with explicit untrusted framing. An assistant reply gets only a fixed general announcement directing the user to the terminal, not unchecked raw-output speech or a fabricated completion attribution. No private reasoning. These are limits of existing uncorrelated host updates.

## Playback policy — automatic local recovery, not remote epochs

Separate gpt-live-playback.ts reuses unchanged PlaybackScheduler:200ms pending PCM plus existing ~80ms native reserve/in-flight write. Four20ms frames RMS>=0.032 enter acoustic activity; fifteen frames below0.013 leave it. **Not validated VAD**, echo cancellation or speaker identification. Noise/echo can false-trigger; quiet speech can be missed. Concrete dependency assessment and official recommendations are in [VAD review](gpt-live-vad-review.md). No platform/backend/dependency changes to claim accuracy.

Qualified speech start clears pending output and immediately flushes native player, including before first output. Mic keeps streaming. Output during speech is dropped, not queued. After detector end (300ms qualified quiet), ten additional quiet capture frames form a short200ms recovery guard. Non-quiet frames reset that guard; renewed sustained speech starts another local epoch/flush. Then NEW arriving continuous output resumes automatically on the same socket. No provider event or server generation ID is invented. Captured frame time is used because native capture is continuous20ms PCM; a stopped capture stream cannot falsely count as quiet. Hard errors remain visible/faulted and do not automatically recover.

This is best-effort local interruption: the primary WS provides no deterministic remote old/new output boundary, so an old server tail can still be heard after the guard. A response beginning during speech/guard loses those samples and may resume mid-sentence. Detector delay, quiet speech and speaker echo remain acoustic limits. Policy deliberately favors usable automatic conversation over an impossible freshness guarantee or indefinite silence. Parent explicitly approved this local practical policy; its earlier strict-restart blocker is resolved in code/tests, not hidden behind an unavailable model gate.

Suppressed output transcripts persist/display as suppressed / “Voice (not played)”; after guard they return to ordinary provisional received text. Already accepted OS/native audio may not physically retract. Overflow/write/flush errors stop voice visibly without cancelling jobs. No automatic recovery of hard failures and no remote turn/truncate/Realtime response.created assumptions.

## Review fixes

Reviewer391e7471 found raw host output was speakable, muted transcripts unlabeled, and rejected stale dispatches could speak. All corrected with regressions. Added actual configured-agent jobs.stop confirmation integration test, not merely a prompt assertion. Added saved offset-context history instead of reading current context on delayed delegation.

## Durable work

Main worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_846afc0f; branch die/implement-genuine-gpt-live-websocket-int-846afc0f.

Children all use prefix /home/tnfssc/.die/worktrees/die-a86675007a5e-task_846afc0f-a86675007a5e-task_:
- bf3dec23: wire adapter3012500 integrated asd6da305; branch die/gpt-live-wire-adapter-bf3dec23.
- a404c383: die/gpt-live-playback-and-local-speech-a404c383;586224f integrated.
- 70947ed7: die/gpt-live-delegation-bridge-70947ed7;69d9b39 integrated as3ddcc40.
- 391e7471: die/review-gpt-live-authority-and-wire-391e7471; review-only findings above.
- d997da26: die/review-local-speech-policy-against-offic-d997da26;84c9b0e integrated as43a0188.

Values unchanged: existing evidence, authority, bounds and built-path principles cover this work. Native/, audio.ts, playback.ts, Gemini session.ts and resampler unchanged from8473682. Realtime only extracts its identical error classifier.

## Verification

Results below. No paid API, user credentials or devices. tests/live-gpt-live-provider.acceptance.test.ts requires DIE_RUN_GPT_LIVE_ACCEPTANCE=1 and explicit DIE_GPT_LIVE_ACCEPTANCE_API_KEY; skipped by default. It tests transport setup/paced silent PCM/finalized close only, not acoustic/delegation quality.

Final Bun1.4.2 checks: **271 passed, 3 paid acceptances skipped, 0 failed;21,858 assertions across31 files** (Live/OpenAI/GPT-Live plus subagent-extension). Used a fresh isolated TMPDIR. A preceding run using the shared default tmpdir hit the existing transcript snapshot64-file retention budget after repeated tests (269 pass/2 host snapshot tests failed); no shared/user snapshots were removed. Isolated rerun resolved test-store pollution, not a protocol change. Typecheck (prepare-assets + tsc --noEmit) and git diff --check pass.

Source and compiled scripts/live-gpt-live-offline-smoke.ts both pass against a loopback fake endpoint, exercising Bearer/start/PCM/context delegation/commentary/local flush/close. Final source CLI --version prints0.9.2. Full CLI build uses --reuse-web with a private copy of existing /home/tnfssc/Code/die/dist/die-web, not a rebuilt web runtime; initial default build failed because a fish PATH assignment omitted git. No trust of mise project config was needed: explicit Bun binary and POSIX PATH used. Final automatic-recovery CLI build passed using --reuse-web; dist/die --version and source CLI --version both report0.9.2, and compiled --help exits0. Bundled reused-web archive SHA256681d39fae172b858b55ac2f80a68f8431f48d0e39aff6104f6878f10af7cfec3. These are packaging/protocol tests, not paid service, device, speech quality, or automatic-resume acceptance.

Parent automatic-recovery direction implemented after the initial271-pass run: removal of restart-only latch, same-socket speech-end recovery after bounded quiet guard, renewed speech/noise guard reset, coherent suppressed transcript status, and hard-error non-recovery tests. Final rerun: **273 passed, 3 paid acceptances skipped, 0 failed;21,869 assertions across31 files**. Typecheck passes. Source and compiled loopback smoke both now exercise automatic recovery and pass.
