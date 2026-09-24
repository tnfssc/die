# Current-session voice orchestration (unreleased)

User accepted v0.8.2 native macOS voice and approved orchestration. This extends working src/live-lab, not old SoX /live. Native capture/playback/helper sources are unchanged. No preview/channel process or publish is part of this work; parent reviews integration before normal release.

## Contract

Gemini remains the voice model; the existing configured die agent does coding. Six narrow tools: session_context, agent_send (follow-up), agent_steer (current agent), jobs_list, jobs_inspect, job_cancel. No shell, file editing, new agent model or new scheduler is exposed to Gemini. Existing JobService remains job authority. Voice cancellation and playback interruption do not cancel work. Cancellation opens trusted terminal confirmation for the exact job, never accepts a model consent boolean. Agent delivery acknowledgment is queued, not completed.

The tasks extension owns the host bridge across voice reconnects. Stable request IDs deduplicate mutations (including failures); reuse with different input rejects. Reconnecting does not replay requests. Session change resets authority. Automatic host updates come only from actual events; no inferred percent/progress. Host snapshots and event text are bounded. Individual SDK context injection is <=4096 chars and total <=65536 chars per connection; limit closes voice visibly without touching jobs. SDK calls/results <=16384 bytes, <=16 pending calls and <=256 call IDs per connection. Host request ledger has a bounded lifetime cap rather than eviction/replay.

Official SDK evidence: installed @google/genai 2.24.0 dist/genai.d.ts exposes Behavior.NON_BLOCKING, toolCall, toolCallCancellation, sendToolResponse, sendClientContent and FunctionResponseScheduling.WHEN_IDLE. Each actual tool invocation receives one actual result; no willContinue/long-lived unsolicited tool-response bus. Replies use WHEN_IDLE so they need not interrupt speech. Independent host events use sendClientContent(turnComplete:false), adding context without forcing an unsolicited spoken turn. This is SDK contract evidence, not paid model-side acceptance. Model may mention completion on its next turn rather than instantly speak over conversation.

## Workspaces

- Integration: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cb0bdb08 branch die/connect-live-voice-to-die-orchestration--cb0bdb08.
- SDK: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cb0bdb08-a86675007a5e-task_00c39aca, branch die/gemini-async-voice-tools-00c39aca, source commit b618f4f.
- Initial host: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cb0bdb08-a86675007a5e-task_f0ffa341, branch die/voice-host-bridge-f0ffa341, source commit 79b3206. Initial module alone was not wired; integration supersedes that limitation and its custom-message steering.
- Host authority wiring: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cb0bdb08-a86675007a5e-task_4e6056aa, branch die/wire-host-authority-into-tasks-4e6056aa.

## Evidence / remaining gaps

Integrated focused suite: 62 tests / 517 assertions passed across 12 files, plus bun run check and full bun run build (Linux). The host wiring test uses separate ExtensionAPI wrappers over the real shared bus shape, actual tasksExtension + liveLabExtension + VoiceSession, fake SDK/audio only. Real TaskManager/JobService test launches only its own harmless local output command, observes completion, then inspects real output. Fake SDK proves responsive audio handling while a tool promise is pending; this does not prove acoustics, Mac runtime, paid provider acceptance or an end-to-end real conversation. No real key, paid call, mic, or user job cancellation was used. Native scoped job completion has no unified JobService event subscription; do not fabricate native completion events or claim native delivery proven by local TaskManager tests.

Values reviewed: no new value needed. Existing truthful proof, one owner, scope/consent and bounded-use values cover this feature.

## Integration findings

Initial worker accessor used a WeakMap keyed by ExtensionAPI. Installed Pi loader creates a distinct API wrapper for each extension, so that cannot wire real factories. Integration replaced it with a synchronous request over Pi's existing shared event bus (not a Gemini tool-response event bus), and the test uses distinct wrappers to catch regression. Initial worker context was metadata-only and steer used sendMessage; final wiring uses sendUserMessage deliverAs followUp/steer and bounded current-branch user/assistant text. Jobs list/inspect delegate to the same JobService; native authorization remains server-owned.

A review called dispatch after voice stop a lifecycle concern. Intent here is explicit: a tool request admitted before disconnect can finish after it, including a separately confirmed cancellation. Voice stop does not revoke already admitted user work. No provider messages received after close execute, and session shutdown invalidates host authority. Changing this to abort admitted work would contradict independent task lifecycle. Parents can review this boundary; no claim that stopping speech is cancellation consent.

Broad test first attempt was incorrectly launched before dist/die existed, hit ENOENT in SDK/goal tests, and was stopped (only our test process). A fresh full-suite run follows the successful build; do not attribute that first failure to voice changes.

Final broad suite after build: 873 passed, 15 skipped, 0 failed (888 tests across 123 files, 5567 assertions). The subsequent admitted-before-disconnect regression test also passed in the 62-test focused rerun. Full check and build passed; built dist/die --version printed 0.8.2 (no version bump or publish). Native audio files are untouched. Logs during this integration: /tmp/voice-build.log, /tmp/voice-all-tests-built.log, /tmp/voice-last-focused.log, /tmp/voice-last-check.log; these are local ephemeral evidence, not durable artifacts.
