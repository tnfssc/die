> Superseded: browser voice was removed. See [web voice removal](../live/web-voice-removal.md). Historical notes only.

# Web live voice port

## Current state — final parent check, 2026-09-25

Gemini and OpenAI Realtime web integration is merged in root. Canonical patch includes provider controls, authenticated route, private owning-Pi bridge, awaited cleanup, branch revocation and controller/UI failure regressions. CLI live cost tracking is also merged independently. Built dist/die and dist/die-web; not installed over the user's binary.

Parent proof:360 root tests pass,3 paid-provider tests skipped;27 canonical controller/UI tests pass; final canonical Chromium route/real-root-bridge gate passes with fake providers. All tracks/sockets released; mute stops uploads, jobsStopped0, paidCalls0. Final maintained build:web, compiled CLI, packaged Origin/auth/static asset smoke, compiled RPC both-provider missing-key + coding-alive smoke, typecheck and diff check pass.

Remaining: physical mic/acoustic/provider acceptance, full packaged active-session navigation, and real-provider latency/CPU/RSS profiling. Browser continuous full-duplex PCM payload estimate4.8MB/min remains a limitation. Short fake-provider browser gate measured5120B up/2880B down for Gemini and6400B up/2880B down for OpenAI; scheduling-dependent test samples, not throughput benchmarks.

Final patch8c963250b249d0818648500fad5fa5da78f552f2e35e3955a4d13b909946432a; web archive07c5fab575da854042194371a1608144a583898e588c2515fe80133fd9a22376; dist/die eb9454b4ce473d01ab88ee0fe3760b012fc50135dd4efed5180a88e14272fd20. Prior artifact hashes are superseded. Sources/worktrees retained below and in live/web-integrated-vertical.md. Value1 now explicitly requires testing shipped/adapted copies, after final review found root/canonical lifecycle drift. No new value added.

Older progress notes below explain decisions and provenance, not current blockers.

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

Async lifecycle worker returned d834e9e:92 tests/typecheck/Chromium fake-media loopback reported pass. Review task_999220d9 underway; vertical owner informed of commit and requirement to await relay.shutdown(). Browser permission prompt can delay verified teardown; close-event timeout reports failure. No paid acceptance yet.

Async review found start-after-stop race during initial retry await and false-success awaited teardown. Fix task_4d852845 fromd834e9e in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4d852845, branch die/fix-awaited-stop-startup-race-4d852845. Vertical owner notified; await fix before device activation. No concrete worklet or Gemini shutdown defect found in that review.

Async fixes d834e9e/e54516b integrated as b6fbf59/1395c56. Parent added ff6983a to prevent duplicate start from overwriting pending ownership and prevent restart during awaited stop retry.49 focused tests/226 assertions and full check pass. Vertical worker has all hashes/API contract.

Real-route review task_647bc161 inspected work-in-progress72e8105: no demonstrated key/job/cost regression, but canonical patch still lacked cached route/UI changes and same-file branch switch lease revocation needed proof. Browser fixture uses actual route/FD but substituted auth/thread owner and separately bundled controls, not packaged app acceptance. Findings forwarded to vertical owner; do not integrate as finished before maintained build + branch fix.

## Final integration in root

All vertical integration commits cherry-picked through8a37bd0. Parent broad regression run:360 pass,3 paid-provider tests skipped,0 fail across44 files,22424 assertions; bun run check and git diff --check pass. Initial run had one test false failure because TMPDIR contained `.cache/` and native-helper test rejects substring `cache/`; reran unchanged tests in isolated /tmp/die-live-final-P5CbX8 and passed. No test assertion weakened.

Parent maintained web build underway using exact verified pinned checkout from worker. Initial launches lacked pnpm/PATH; corrected process-local PATH to installed pnpm without changing trust. Final independent route review task_e7b64a6b underway. Packaging full active-session UI and paid/physical mic still untested.

## Final review caught shipped-copy drift

Parent built web archivea10b2da1121642ed49e75b3a3d5d8bfb19b7ddeeb63979456edcbccdf6d4644b and compiled CLI; packaged auth/static asset and compiled RPC both-provider missing-key/coding-alive smokes passed. Do not treat this as final acceptance: review task_e7b64a6b found canonical apps/web/src/live/controller.ts missing e54516b/ff6983a lifecycle fixes already tested in root reference. It can resolve failed stop and let UI discard old ownership. Other prior auth/branch/patch blockers resolved.

Fix task_bddc2885 from8a37bd0 uses /home/tnfssc/.die/worktrees/die-a86675007a5e-task_bddc2885, branch die/fix-canonical-browser-controller-drift-bddc2885. Must patch actual shipped copy, preserve protocol differences, test actual copied controller/UI and add drift guard, then regenerate maintained patch and rebuild. This is the last known code blocker; paid/physical mic/full packaged active-session UI remain untested.

Lesson: root reference tests and actual route fixture tests both passed while shipped UI cleanup still drifted. When code is copied/adapted into maintained upstream patch, apply lifecycle regressions to that shipped copy too. Shared ownership and package test values cover this, with an explicit reminder added to value1.

Final drift fix01cc279 integrated asb04a805. Parent preserved isolated source at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_bddc2885/.cache/canonical-voice, then updated the original durable fully provisioned worker checkout using reverse-checked prior patch + new patch. Maintained full build now running there against exact final root patch. Canonical tests now include actual controller races and UI owner retention across thread/provider switch,27 tests worker passed.
