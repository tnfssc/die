# Scoped Live controls through execute (2026-09-24)

## Decision and audited route

Reuse execute, not a second voice executor. The configured agent already has an isolated JS/TS worker whose IPC helpers dispatch through the owning tasks extension to JobService. JobService owns the session TaskManager and authenticated native adapter. Giving GPT-Live arbitrary code execution or inventing Realtime function calls would duplicate authority and does not match its supported protocol. The small scoped APIs jobs.stopWork() and live.stop() are **helpers inside existing execute**, not new provider tools or another task system. Existing exact-ID jobs.stop(id) remains available.

GPT-Live supplies only client delegation ID/offset plus provisional timestamped fragments. The bridge passes a bounded uncertain snapshot to the same configured agent using supported sendUserMessage with deliverAs: steer, not a replacement ASR command parser. The agent interprets explicit intent or asks when genuinely unclear, then uses execute and its normal permissions. Existing delegated job-cancellation confirmation is retained, not expanded to voice shutdown. Queued delegation proves delivery only. Barge-in, transcript corrections, voice disconnection and provider tool cancellation never invoke stopWork.

## Results and lifecycle

- stopWork enumerates local running jobs and paginated authenticated native tasks, reusing existing kill/cancel operations. It distinguishes pending, acknowledged cancellation, already-finished work, and errors per job. discoveryComplete describes enumeration, **not cancellation completion**; discovery failure or individual errors makes the aggregate partial. A running cancel response is pending. No fabricated all-stopped status.
- Foreground execute invocations have their own lifetime outside JobService. The host registers cancellation on the existing IPC response ACK, so the scoped job report reaches the worker before that worker is aborted. ACK means delivery, not exit. Foreground results remain pending unless the host actually observes idle. The stop request can intentionally end execute as cancelled; Live host observations retain the bounded job/foreground report. Session and branch are rechecked at the ACK boundary. No unrelated session foreground is signalled.
- Local CLI subagents handle their parent's SIGTERM by invoking their **own existing TaskManager.shutdown()** before exit, propagating shutdown requests to detached child jobs. This adds no registry/scheduler. Native subtree cancellation remains backend-owned. Parent exit is not proof every recursively detached descendant exited; pending/error observations and this limit must remain explicit. Offline tests fake trees/signals; no production subtree-stop claim was measured.
- live.stop uses the existing shared extension bus to find the active voice owner, awaits microphone/audio and provider cleanup, and reports teardown errors. Concurrent calls share pending teardown; another start cannot overlap it. Ordinary transcript leaf advancement does not change voice ownership. The check uses the actual session-manager owner, session ID and file. Voice shutdown preserves jobs. For an explicit combined request, await live.stop first, then jobs.stopWork (which can abort its own foreground).
- Audio helper stop timeout still forces resource cleanup, but records missing acknowledgment rather than claiming observed microphone shutdown. GPT-Live final-usage/close acknowledgment remains distinct from local closure. Google/Realtime close failures remain visible. Mac audio mechanics and transcript/history preservation are unchanged.

## Evidence and limits

Fake local/native tests cover pagination, discovery failure, mixed cancellation failure, running/pending responses, observed cancelled versus already-finished responses, owner isolation, local descendant shutdown ordering, foreground ACK order and revoked delivery. Compiled-execute tests exercise real IPC helpers with fake host/lifecycle jobs. Provider regression includes GPT-Live, OpenAI Realtime and Gemini offline seams; paid acceptance tests stay skipped. Grouping has speaker, time-gap/span, character and idle-pause bounds, preserves arrival order of late corrections, and never upgrades partial ASR into handoff authority.

**Supported-route latency:** steering is interpreted at the configured agent's next available steering boundary. A long blocking tool can delay it. No direct GPT-Live cancellation intent field exists in this implementation; do not claim instant busy-agent preemption or infer cancellation from ordinary speech. Physical devices, paid providers, real user jobs and native servers were not exercised. Native scope/cancellation semantics are the existing authenticated adapter contract, not a new voice permission.

The full build command encountered missing pnpm; the CLI was compiled against the existing local web archive for offline execute testing. This is not a rebuilt web/release artifact. Integrated concurrent diagnostics publication commit 95eae2c from origin/develop; no develop push, tag or publish was performed here.

Offline validation: 261 passed, 3 paid/provider tests skipped, 0 failed across 35 files (Live/all providers, transcript, stop-work, foreground ACK, local fake tree, T3 native routing, IPC protocol). Typecheck passed. Use a fresh TMPDIR so transcript snapshot tests never share the real snapshot budget, and SHELL=/bin/sh so local shell fixtures do not inherit interactive mise trust diagnostics. An initial test run with the interactive fish shell failed two exact-output fixtures only because those startup diagnostics were captured.

## Worktrees / continuation

- Integration: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e689d2f7, branch die/fix-voice-job-controls-and-transcript-gr-e689d2f7.
- Transcript: same path prefix plus -a86675007a5e-task_457a9cad, branch die/gpt-transcript-grouping-457a9cad, source commit 627e1a7.
- Job host: prefix plus -a86675007a5e-task_051ba39b, branch die/scoped-host-cancellation-via-execute-051ba39b, source commit 023a9fe.
- Lifecycle: prefix plus -a86675007a5e-task_628eaa0d, branch die/live-lifecycle-execute-integration-628eaa0d, source commit 2ebef65.
- Local descendant audit/implementation: prefix plus -a86675007a5e-task_ab2a8a38, branch die/close-local-descendant-cancellation-gap-ab2a8a38, source commit bf53edd.
- Read-only reviews: prefix plus -a86675007a5e-task_65fa0dc4 and -a86675007a5e-task_7348d83b.

Values unchanged: existing one-owner lifetime, bounded state, leave unrelated work safe, reuse working authority, truthful observations, and durable handoff principles cover this decision. See [stop work](current-session-stop-work.md), [self-stop](self-stop.md), [grouping](gpt-live-transcript-grouping.md), [local termination](../jobs/local-agent-termination.md).
