# Web live voice port

## Goal — 2026-09-25

User asks to investigate current live mode and port it to the web UI, not desktop.
UX and performance both matter. Performance means upload/download bytes, animation cost, and server load.

## Work underway

Implementation task: task_1287f8ed.
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_1287f8ed
Branch: die/build-ux-first-web-live-voice-port-1287f8ed
Base: 1d251740a51e1a81c104288f1a6e41f324a543c9
No implementation integrated yet. Agent must return commits and tests for review.

Read-only research: task_c60d8a0f (CLI live), task_3c4b470a (web).
Web research found the shipped source comes from the pinned upstream and integrations/t3/upstream/die.patch. Cache edits alone do not ship.

## Checks for the port

Keep provider secrets off the browser. Compare direct short-lived provider auth with a server relay before choosing. Count bandwidth and bound queues. Avoid unnecessary audio encoding and per-frame React updates. Idle UI should not animate.
Start mic only on user action. Show real connection and listening states. Handle denied permission and retry. End must release browser audio, mic and connection. Keep voice interruption separate from stopping work. Preserve current session ownership and the two concurrent loops.
Do not claim real browser/provider acceptance from unit tests alone. No paid provider probes started.

Values unchanged so far. Existing values on simple design, bounded use, truthful UI, and safe ownership cover these needs. Implementation findings may change that assessment.

## Foundation ready for review

Worker returned 084920a, bce62d2, f5cdc52. Not integrated. 37 offline tests reported passing; real audio, auth/session wiring and shipped UI absent. Independent code review task_b4a1bbc2 and low-bandwidth design review task_ad7626d5 are running.

Important: binary PCM is cheaper than browser base64 but still about 4.8 MB/minute browser full-duplex payload, with additional server/provider traffic. These are estimates, not measurements. Do not settle the shipping transport before reviewing direct WebRTC/Opus + trusted tool sideband against the user’s explicit bandwidth priority. Foundation can be retained without making it the shipping default.

Independent review found real ingress-budget and failed/late-teardown gaps. Findings saved in live-voice-foundation-review.md. Fix task_3301a17b runs from f5cdc52 at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3301a17b, branch die/fix-web-voice-foundation-lifecycle-and-b-3301a17b. Do not integrate original foundation before reviewing fixes.

## User decision: both providers

User explicitly requires both Gemini and OpenAI for first web version. Do not narrow shipping scope to OpenAI-only. Common controls may sit over different transports. Verify public provider docs before assuming Gemini supports Opus or WebRTC.

Next implementation task_37ea736e runs from f5cdc52 in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_37ea736e, branch die/implement-dual-provider-web-live-integra-37ea736e. Owns public API verification and actual maintained web/session/browser integration; foundation fix task_3301a17b owns relay/controller fixes. Parent must combine and review both. Paid/device validation still not authorized or run. Values unchanged: user scope and measured resource costs already fit existing guidance.

Fix commit 23f996e returned from task_3301a17b. 23 focused tests and typecheck reported passing. Independent follow-up task_28254a2b reviews it before integration. Provider SDK backlog remains unproven; no route should be enabled on foundation alone. Dual-provider worker has parent handoff note with fix commit and separate CLI-only cost scope.

Follow-up review found three browser reentrancy/disposal gaps in 23f996e: pending start latch on synchronous end; disposed prevents failed cleanup retries; synchronous registration cleanup throws are lost. Fix task_6c669f76 uses /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6c669f76, branch die/close-remaining-browser-lifecycle-races-6c669f76, base 23f996e. Await fixes before enabling any device path.

## Integrated foundation

Parent cherry-picked 084920a, bce62d2, f5cdc52, 23f996e, 1b0bc4a into root after review. Parent ran browser, relay, integration, orchestration and session suites: 47 pass, 0 fail, 489 assertions. Foundation is now in source but remains unused by shipped UI. Real adapters, authority wiring, SDK backlog and provider/device acceptance remain pending with dual-provider integration worker.

## Phase two returned, vertical feature still missing

Dual-provider branch ends 08b87bc. Includes public-doc transport audit, raw bounded Gemini adapter, OpenAI factory authority, host leases, real browser adapters and Chromium fake-media loopback. Not integrated yet. 66 tests/typecheck and loopback reported pass. Actual maintained web bridge/route/UI absent. No Opus/WebRTC path for Gemini verified; direct OpenAI shared session mutation needs authority restrictions not established in docs. Server-owned sessions selected provisionally, PCM bandwidth limitation remains.

Next tasks from08b87bc: task_cbd3af59 async lifecycle+bounded worklet/cancel in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cbd3af59, branch die/complete-web-voice-async-audio-lifecycle-cbd3af59; task_6394ca7b actual vertical owner IPC/canonical patch/UI/build in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6394ca7b, branch die/wire-live-voice-into-real-web-sessions-6394ca7b. Foundation ownership restrictions lifted for those fixes. Independent host/provider review is also underway. CLI cost completed independently; preserve its onUsage hooks on merge.

Parent integrated phase-two module commits inertly after authority review. 48 focused web/provider/lease/session tests pass (229 assertions), full check passes. Independent review found no demonstrated permission bypass or duplicate OpenAI handoff; branch-switch revocation must be enforced at integration, not by freezing leaf ID across normal appends. Pending Gemini close issue belongs to async lifecycle task. Both findings forwarded to vertical worker. No shipped route enabled.
