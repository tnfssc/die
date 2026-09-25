# Final web voice integration handoff

Owner: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6394ca7b (branch die/wire-live-voice-into-real-web-sessions-6394ca7b). Base08b87bc. Implementation complete; no inert controls. See web-integrated-vertical.md and web-route-browser-acceptance.md for trust model, bounds and exact proof limits.

## Verified final state

- Canonical die.patch includes authenticated route, exact owning Pi spawn FD3/FD4 channel, visible Gemini/OpenAI controls and browser adapters; root extension owns real SessionHost lease/credentials/provider connection.
- Awaited provider teardown for BOTH providers; route/browser stop ACK; provider/thread switching retains failed cleanup; same-file branch revocation; no auto-confirm or browser tool authority; voice end preserves coding process/jobs.
- Critical last correction7ce3a3a: Queue.shutdown did NOT end inherited FD3; Queue.clear+Queue.end now generates real EOF. Actual child test verifies EOF without killing coding process; reverting old behavior fails.
- Root tsc +162 focused tests/911 assertions pass. Upstream61 tests + server/web typechecks pass. Chromium production component+route+real pipes+root bridge/SessionHost/relay with fake provider passed both providers, actual mute no-PCM, delayed stop ACK, thread/provider switches, missing key and live stale-owner revocation. Final run44160 raw input PCM bytes aggregate /6720 output, seven providers stopped, jobsStopped0. Counts vary with scheduling.
- Fresh packaged backend (real auth, no mock layer) rejects missing/evil Origin403 and unauth same-origin401 and serves exact shipped voice JS asset. No authenticated packaged owner409/full active packaged-thread UI test claim.
- Compiled dist/die --mode rpc with real extension/private pipes passes both missing credentials, stopped ACK and successful get_state before/after; no paid prompt, coding RPC stays alive.
- Final maintained build:web and root build --reuse-web succeeded. dist/die-web/SOURCE.txt pin b488c57f3f9f1688e31c53daee99e29dd1d0baa2; patch SHA256 bc87399d43512eb89eccb644d8e6172ca7e25252a5f38dd7c153a17471af3786; archive SHA256 0d0c94f9f292d4f13c2fa8b373e7fc54ecf3d9e44e40068c7f2851d2eca49ab4. Prior hashes in intermediate commit notes are superseded.

No paid/provider/device mic probes. Component fixture isn't whole packaged app navigation. CPU/RSS/paint/real acoustic latency unmeasured. PCM full duplex4.8MB/min before framing/TLS; provider base64 adds roughly4/3. Browser idle before Start opens no mic/socket; mute sends no PCM. No animation loop.

## Parent dependencies

Equivalent picks already retained here: parent df92281→1196ab6 and1b50737→97d4c25 (CLI cost); d834e9e→2079de0, e54516b→90b1308, ff6983a→be20092 (async lifecycle). Parent with originals should skip equivalent picks. Other commits below are this integration. Final handoff/docs commit follows this list on branch.

## Exact commit sequence after base08b87bc

1196ab6a8dc380e186e6f9416146b2f2c7434537 Track CLI live voice provider usage in session cost
97d4c25223335329c2e2c15351fa64c8637bc9da Mark unpriced Gemini cache usage unknown and preserve close failures
363d99fae4f06dfceeb4cdc991cea2c5b08b7d0f Add owning Pi private web voice IPC bridge
2079de070a2d57c15b8938d5850a9058aa927695 Await browser live teardown and verify web Gemini shutdown
74aee942ed2b67e65af3b0fbae1f3724867bd8f8 Add canonical voice route browser instrumentation and acceptance gate plan
034b329086378fe6a3493a1e8befd85d50f1bf6e Await owning web voice shutdown and aggregate live lifecycle owners
90b130800f744599bcac0ac3f6371ff03f2641bf Make browser live stop await verified cleanup and invalidate pending starts
be20092d700f7c15f030ba8633c9345127a8a25c Keep browser acquisition owned through duplicate start and stop retry
cfc46025b44542eaedc2efa7d63bfd762d7cabba Add opt-in shipped voice route Chromium acceptance gate
841927f16a6a2356eea5a4e2f3e9eb255b16cacd Exercise spawned Bun web voice FD pipes with offline providers
14a9443dae081c994bf5f1e20119b9db7b61cb9f Keep host-access fixture compatible with CLI voice cost entries
12210661e32e7725eec67401374c38db3bfe6b12 Buffer bounded early voice socket events before listener attachment
4a763cdd960dc1cd92fc070222b0210c361071c0 Report canonical voice binary PCM payload excluding frame tag
f554464d4bd14f5c03d999737ec56b27407e3bcf test:
72e8105d2b941f33657ba25128f4d4feffe85f91 test:
99d69a18a9a3bc5b4db57776015ccf9d050ec02e Exercise canonical voice route through real root bridge and delayed teardown
63e9524f8a5b47f3424cd5afda82421e3f05810f Await verified OpenAI web socket shutdown before relay stop
872fb706bb962b26426fafa179350d1bae824e6d Revoke web voice authority on same-file branch navigation
31efa5fc15d0282ece549047ba22f7be729abbad Wire pinned T3 voice route to scoped Pi process pipes and browser controls
d55141e6deee348e3b90ef5435cd6af157b334fc Await browser voice teardown and include lifecycle UI in canonical T3 patch
c0d7638ac5ba1fdf30747748e304f6be71e33830 Block voice restart until failed owner cleanup is retried
60d121e51d856b45f3392e6fb529fdb96608f1a1 Record attested pinned T3 voice build evidence
0202639519da29a7d3266d5b86810e54b4424016 Add packaged web voice route smoke test
443323e3fdf8d8026bc5055f272deb61c565955e Fix packaged smoke launch environment
c80a517a81358cc4cb136e9968d0859d364af2f1 Bound readiness probe in packaged route smoke
7ce3a3a625acb8da8cc48f505057ea83ed09eb53 Close revoked Pi voice pipe without interrupting coding process

## Durable worker locations

Worker worktrees use owner path plus -a86675007a5e-task_SUFFIX. Branches:
-86494437: die/canonical-upstream-web-voice-vertical-86494437; pinned checkout .cache/die-t3code-b488c57f3f9f1688e31c53daee99e29dd1d0baa2 (final7ce3a3a source edits are present, root maintained patch is authority).
-e6717718: die/root-private-pi-voice-ipc-host-e6717718.
-fd452ae3: die/real-anonymous-pipe-bridge-integration-t-fd452ae3.
-f09cc57f: die/actual-shipped-route-browser-offline-acc-f09cc57f.
-36e27263: die/runnable-canonical-route-browser-bootstr-36e27263.
-40f07239: die/canonical-visible-web-voice-controls-40f07239 (initial UI artifact superseded by integrated patch).
-15f5f084: die/verify-openai-web-provider-socket-teardo-15f5f084.
-8f02df71: die/packaged-web-voice-auth-route-smoke-8f02df71 (initial smoke strengthened by integrator).
-453ba395: cancelled without source edits after stalled model; integrator implemented UI ownership in pinned checkout.

All final code is committed in owner branch; build output is ignored dist. Existing values unchanged: exact ownership, bounded resources, visible errors, preserve user work, and truthful whole-path evidence already cover the lessons.
