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

## Review fixes (2026-09-24, not published)

Integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d28401f8. Transport worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d28401f8-a86675007a5e-task_7f5efa12, branch die/voice-transport-flood-and-duplicate-fixe-7f5efa12 (cfa04b1). Host worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d28401f8-a86675007a5e-task_51e4b4b6, branch die/native-completion-and-user-authorization-51e4b4b6 (8ac5b74). Both integrated here, plus integration edge-case tests/fixes.

- Context updates coalesce for 100ms into at most 4096 characters, dropping oldest whole observations with an explicit gap marker. Reserve marker space even when an oversized update follows a full queue. No cumulative 65k shutdown; ongoing microphone audio continues through floods. Provider context/session lifetime still applies; this is not unlimited provider context.
- SDK call IDs cache bounded responses (256 IDs, 16KiB per result) for the connection lifetime. In-flight duplicates share the original eventual response; completed duplicates replay it, even if arguments differ, without re-execution. Existing capacity ceiling still closes voice, not agent jobs; no eviction that would permit duplicate execution.
- agent_send/steer require exact (trimmed) text from completed input speech, consumed once. Job observations/output cannot supply authority. Unused speech expires after the response turn; same-message tool + finished transcription is tested through real VoiceSession and extension wiring. No new terminal confirmation for ordinary speech; existing configured-agent permissions and explicit cancellation confirmation remain. This deliberately does not allow model-expanded instructions or paraphrases. SDK finished is optional: missing completion markers, delayed calls after turn completion, or transcript mismatch fail closed, not silently authorized. Transcription is provider-derived, not proof of speaker identity or perfect recognition.
- A non-overlapping 5s scoped JobService watcher discovers at most the first 20 jobs and inspects up to 20 previously observed active native jobs absent from that page, with a shared 5s AbortSignal deadline. Only observed active-to-terminal transitions produce completion. Refresh errors report stale status, not completion. Unsubscribe stops polling; reads cannot mutate jobs. Short-lived jobs between snapshots, jobs hidden behind local/native pagination, or jobs completed before discovery can be missed. No claim of exhaustive native event delivery.

Actual API evidence: installed @google/genai 2.24.0 dist/genai.d.ts declares Session.sendClientContent, Session.sendToolResponse, FunctionResponseScheduling.WHEN_IDLE and optional Transcription.finished. src/tasks/job-service.ts jobs.list (around line 667) delegates to adapter.list and returns projected jobs with a mixed cursor; jobs.inspect delegates to adapter.observe with the caller AbortSignal (around line 736). The watcher calls those existing scoped entry points, not a made-up event API or an extra scheduler. t3-native-routing tests exercise real JobService with a fake native adapter; native-completion voice tests inject service snapshots. Neither is evidence of a live backend conversation.

Verification: 89 tests / 655 assertions across live-lab*, live-host*, job-service and t3-native-routing passed; bun run check passed. Tests use fake SDK/audio/native backend and test-owned harmless local processes only. Initial routing test run had four exact-output failures from the user's fish startup emitting mise untrusted-worktree warnings. Rerun used SHELL=/bin/sh for test-owned shells; no trust setting changed. No paid calls, microphones/speakers, real user-job mutations, version bump, or publication. Native audio/helper/playback code unchanged. Local logs: /tmp/voice-review-final.log and /tmp/voice-review-check.log (ephemeral, not durable evidence).

Values unchanged: existing bounded-use, permission/scope, truthful-evidence, and simple-design values already cover these fixes.

## Pi 0.87.1 host-discovery investigation (2026-09-24)

The reported promoted-build conversation said it had no tools. Host-bus failure is **not reproduced** in the pinned SDK: `dist/core/event-bus.js` calls EventEmitter.emit synchronously; its async safeHandler invokes handler(data) before the first await. Therefore the synchronous accept callback in src/live/host-access.ts runs before getLiveHost returns. Do not replace this with async discovery based solely on the async keyword.

Runtime trace: src/cli.ts registers die-tools before die-live. Pi's DefaultResourceLoader uses one eventBus for factory extensions; loader.js gives each ExtensionAPI forwarding emit/on wrappers. ExtensionRunner.createContext exposes the same runner.sessionManager via getters for event and command contexts. Tasks session_start sets owningContext; registerLiveHost requires identical sessionManager and returns its existing JobService/TaskManager authority. LiveHostBridge additionally captures session ID/file and rejects changed scope. Live entry requires local TUI+TTY (not RPC/print/SSH/web/child); the regression overrides only this local-device gate and uses a print context, fake audio/provider, and real SDK bus. It does not exercise the installed terminal executable or a provider conversation.

Updated tests/live-host-access.test.ts uses exported createEventBus from the installed pinned SDK, distinct API wrappers, unavailable-before-start / wrong-owner / unavailable-after-shutdown checks, all six declarations, and existing real bridge/VoiceSession dispatch coverage. No production boundary change justified. Missing host still currently warns then permits audio-only running in src/live/extension.ts; that is not proof of healthy orchestration and remains a separate status/product-boundary concern for the parent task. Provider declaration acceptance remains unproven here.

Validation: frozen worktree dependencies and prepare:assets; host access + bridge tests (8 tests, 51 assertions); bun run check. No devices, provider calls, application installs/releases, credential reads, or user jobs. Values unchanged: evidence honesty, existing authority, and truthful status already cover this investigation.

## Model turns are not user-request boundaries

The earlier rule expiring unused speech at every model turnComplete was wrong
for NON_BLOCKING tool chains. Real Google/installed-host probing showed a
successful jobs_list followed by model completion, then an exact authorized
agent_send rejected because the grant had already been cleared. Current code
keeps the latest completed exact request once for60s; fresh input, interruption
and stop revoke it. See [measured failure and fix](missing-tools-after-promotion.md).
This does not settle the separate missing-finished-marker/paraphrase behavior
seen in manual-activity synthetic speech. Native automatic input still needs
real spoken acceptance. Tool source now lives in src/live.
