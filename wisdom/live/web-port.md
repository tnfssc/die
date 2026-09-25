# Web Live port foundation (not shipped voice)

## Ownership and source traced

- Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_1287f8ed
- Branch: die/build-ux-first-web-live-voice-port-1287f8ed
- CLI: src/live/extension.ts owns native capture/playback, provider selection and lifecycle; src/live/credentials.ts loads canonical agent auth; src/live/orchestration.ts adapts completed speech to src/session/operations.ts. src/session/host-access.ts gets the existing host over the Pi extension event bus. Voice and coding run concurrently; ending voice is not stopping work.
- Web: src/t3/web/launcher.ts launches embedded upstream backend; integrations/t3/upstream/source.json pins b488c57f3f9f1688e31c53daee99e29dd1d0baa2 and die.patch is authoritative. build/build.ts checks HEAD+patch before building. Cached upstream was read, not edited.
- Patched upstream server.ts builds Effect HTTP/WebSocket routes; auth/DieWebAuth.ts enforces exact loopback origin in no-auth mode; normal EnvironmentAuth owns browser sessions. orchestration-v2/Adapters/PiAdapterV2.ts drives the owning Pi process over JSONL RPC, not a local SessionHost object. A browser thread ID alone is not authority to create one.

## Scope decision

Do not ship a dead microphone button or pretend a generic relay has an authenticated session. This chunk implements bounded binary relay/lifecycle seams and offline tests only. Missing: authenticated upstream route and owner-bound Pi IPC bridge; canonical auth adapter wiring; actual browser AudioWorklet capture/resampling/playout; shipped controls and permission UI; build inclusion through canonical patch. The implemented transcript bridge deliberately matches Gemini only. Realtime item-correlated completion and GPT-Live provisional delegation are not supported by this relay yet. No browser can start Live from this commit. No credentials loaded or paid calls performed.

The relay accepts an already authorized SessionOperations supplied by its future host, preserving the two independent loops. Its close path releases only voice resources/subscriptions, never jobs. Server credentials stay server-side. Do not expose the relay before authentication, Origin checks, per-owner exclusivity and owning-session shutdown are wired. No fallback to an unrelated session or synthetic permission policy.

## Transport decision and costs

Provisional foundation: binary PCM browser/server relay, reusing existing provider orchestration. This is an integration choice, **not a bandwidth win over direct WebRTC**. Revisit before enabling browser voice, especially for remote deployments.

Estimated steady-state full-duplex payload at 16kHz input / 24kHz output, mono signed 16-bit:

| Path | Browser upload | Browser download | Server audio traffic |
| --- | ---: | ---: | ---: |
| Binary PCM relay | 32,000 B/s | 48,000 B/s | 80,000 B/s browser leg + ~106,700 B/s provider base64 leg |
| Base64 browser relay | ~42,700 B/s | 64,000 B/s | ~106,700 B/s each leg |
| Direct ephemeral WebSocket PCM | provider-specific, often ~42,700 B/s | ~64,000 B/s | no audio through application server |
| Direct ephemeral WebRTC/Opus | illustrative 16–32 kbit/s = 2–4 kB/s per direction | 2–4 kB/s | no audio through application server |

These are payload estimates, not measured network/CPU results; exclude TLS, RTP, WebSocket masking, JSON and packet overhead. Codecs and silence suppression vary. Binary relay saves 25% versus base64 on the browser leg: 4.8 MB/minute full duplex instead of 6.4 MB/minute. Relay server total traffic is approximately 11.2 MB/minute per continuously full-duplex session. Direct WebRTC is materially better for remote bandwidth and server CPU/memory, browser echo handling and congestion control.

Why not direct now: the existing provider contracts are server-side WebSocket/SDK adapters, completed-input/tool authorization is host-owned, and GPT-Live has a distinct wire/delegation contract. Ephemeral minting alone does not move authoritative tools, completed transcripts, session ownership and provider-specific sideband support safely. Never give a long-lived key to a browser; ephemeral bearer grants also require narrow TTL/session scope and authenticated issuance. A future OpenAI-only direct WebRTC + trusted sideband prototype should compare real RTT, input-to-playout latency, barge-in, packet loss, CPU and idle cost against this relay before deciding production transport. Do not assume all three provider wires support identical ephemeral/sideband semantics.

Performance rules: no browser base64, React audio-frame updates, requestAnimationFrame waveform or idle polling; no compressor required for PCM socket frames. Set perMessageDeflate=false on a dedicated audio socket rather than inheriting upstream RPC compression. Bound socket output and playout; fail visibly instead of accumulating latency. Existing provider base64 conversion remains server-only and its transient allocation/GC costs need measurement. No server audio mixing/resampling/recording introduced by this foundation.

## Remaining acceptance

Before UI activation: wire authenticated route in maintained patch, verify exact source, build actual web/server artifacts, test cross-origin/unauthorized/foreign-owner attempts and same-owner multi-tab leases. Route controls must never grant work cancellation or confirm provider-requested cancellation automatically.

Browser/manual (not run): secure-context and permission denied/dismissed/revoked; device removal; echo/no-headphones; mobile audio unlock; 44.1/48k capture conversion; mute actually ceases capture forwarding; end/unmount/thread switch/backend loss close tracks, sockets and audio; reconnect requires deliberate user retry; rapid start/end race; no idle animation/timer; bounded slow-network playout; barge-in flushes speech but agent/job continues. Test real provider only with user approval and budget. Verify transcript finality and host updates alongside speech, including stale/replayed commands.

## Values assessment

Existing values cover this change: trace architecture, preserve ownership, bounded resource use, truthful state and evidence, smallest safe seam, and leave resumable proof. Values unchanged; no new general lesson warrants expanding them. This note records the local recipe and explicitly distinguishes tested foundation from missing shipped integration.

## Implementation and offline proof

- web/live/controller.ts owns explicit acquisition, readiness, mute/end/dispose, pending-handshake abort and late-result release. Resource cleanup failure is visible rather than a successful ended state. web/live/protocol.ts decodes bounded binary/control messages and hides arbitrary remote error text.
- src/live/web-relay.ts adapts binary browser audio to the existing provider interface; completed Gemini transcript segments feed createOrchestration. Provider keys are server-only arguments. Host observations continue while speech is active. Ending revokes future voice tool execution and unsubscribes without stopping jobs; close reports synchronous teardown failures. A real async device/socket adapter must provide and verify actual closure, not merely enqueue it.
- Inputs: 100ms/3200-byte maximum frame; browser unsent input 200ms/6400 bytes. Outputs: <=200ms/9600-byte chunks, browser playout and server socket backlogs <=250ms/12000 bytes. No controller audio queue or repeating idle timer. Setup/session deadline timers are cleared on end. Existing provider/SDK buffers remain outside these counts. Large provider output bursts currently fail visibly if they exceed bounded playout; provider pacing and actual browser scheduling must be tested before activation, not silently relaxed to multi-second latency.
- Test validation: **37 passed, 0 failed, 473 assertions** across web-live-browser, web-live-relay, web-live-integration, live-orchestration, live-session, session-input, live-host-access. Fakes only. Integration proves binary bytes, authority delegation, concurrent host updates, stale epochs, interruption without capture/work cancellation, mute and resource release. Does not establish acoustic UX or real network latency.
- TypeScript whole-project noEmit passed after local prepare-assets. Local dependencies reused via symlink; nothing installed, no credentials read. Initial typecheck before preparation failed only for absent generated runtime-assets JSON files.
- Bun browser-target bundling of controller/protocol passed (approximately 6.9 kB unminified combined at first run); Bun server-target relay bundle passed (~12.6 kB excluding a concrete provider SDK). These are isolated foundation build probes, **not a rebuilt shipped web UI**. No provider imports or Node APIs in browser bundles.
- Read-only pinned-source verification passed: cached upstream HEAD exactly b488c57f3f9f1688e31c53daee99e29dd1d0baa2 and verifyWebSource accepted HEAD + canonical die.patch. Patch unchanged. Full build:web intentionally not performed (would install upstream dependencies); no UI was integrated to build. Changed-file formatting and git diff --check passed.
- Shell startup emitted mise untrusted-worktree warnings; direct absolute Bun 1.4.2 commands still executed. No persistent trust changed.

Worker provenance (already integrated into this feature branch): browser worker /home/tnfssc/.die/worktrees/die-a86675007a5e-task_1287f8ed-a86675007a5e-task_79a04d40, branch die/browser-live-lifecycle-foundation-79a04d40, original d4fa716a76f382fd8bc7f6bcf074cfcd5424baf3; server worker /home/tnfssc/.die/worktrees/die-a86675007a5e-task_1287f8ed-a86675007a5e-task_f4226fa9, branch die/live-binary-relay-foundation-f4226fa9, original bb295d7161b170e12e6f1baa6b5b24e9a978965a. Parent integration tightened queue bounds, fixed interruption semantics, added teardown failure reporting, transcript accumulation, shared wire decoding and cross-boundary tests. Resume from feature branch, not original worker commits.

## Independent foundation review follow-up — 2026-09-25

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3301a17b (isolated, unshipped). Review: wisdom/web/live-voice-foundation-review.md. Input now has aggregate 6,400-byte burst credit replenished at 32 bytes/ms (16 kHz PCM16); third immediate full frame ends relay with sanitized input_overflow. This is a rate limiter, NOT a bounded provider-send queue. Muted frames do not consume credit. Fakes prove overflow; actual provider pacing/latency is untested.

Relay close retains failed unsubscribe/provider/socket releases for subsequent close retries; it reports stopped only after successful release. Browser controller retains failed closures, blocks new start during pending acquisition or unverifiable cleanup, retries on end/start, and reports late mic/socket release failures as error even after ended. Adapters must make stop/close idempotent and verify actual release, not merely enqueue it. Optional revocable owner capability (valid/onRevoke) closes relay and denies tools/audio after revocation. Future route MUST provide a capability tied to session ownership/switch and verify actual closure: the optional foundation contract does not itself authenticate a socket.

Provider backlog assessment: Gemini LiveSession.sendAudio calls SDK sendRealtimeInput returning void; installed @google/genai 2.24.0 node implementation serializes and calls internal conn.send(JSON) without exposed socket bufferedAmount, acknowledgment or drain. Repeated sendClientContent flushes coalesced context every ~100ms in src/live/session.ts, but SDK socket bytes are not measured. OpenAI session's private send checks socket.bufferedAmount > 1,048,576 before send (not projected size); its context is coalesced too. Neither proves strict upstream boundedness. Relay input rate limiting does not establish SDK queue bound or end-to-end flow control. DO NOT enable a real socket route until concrete provider adapter exposes measurable backlog/overflow (or proven bounded send/drain) and handles context as well as audio. No credentials or real provider used. Performance transport choice remains separate review; no UI route added.

Targeted offline tests cover ingress bursts, cleanup retry, late release, revocation and existing cross-boundary paths. Typecheck after prepare-assets. Values unchanged: bounded use, ownership, truthful state and simple seams already cover these lessons.


## Browser lifecycle review follow-up — 2026-09-25

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6c669f76; branch: die/close-remaining-browser-lifecycle-races-6c669f76; base: 23f996e0932b4dbee22c8211befa48334184140a. Scope: web/live/controller.ts and tests/web-live-browser.test.ts only; no shipped UI or relay changes. Synchronous subscriber end/dispose during requesting-mic now runs inside start's try/finally, clearing pending; a new start can acquire after end, but never after dispose. Dispose marks ownership closed before ending, clears listeners, and later end calls may retry failed cleanup without reopening acquisition. Synchronous end/dispose during transport.onMessage or capture.onPcm16 registration now routes the returned unsubscribe through releaseLate, preserving thrown releases for retry instead of silently losing them. Late mic/socket release failures remain retryable after disposal. Offline regression tests cover these reentrant paths, unresolved cleanup blocking acquisition, and retries after dispose. Targeted Bun 1.4.2 test: 17 pass, 0 fail; git diff --check passed. No real devices, sockets, credentials, trust change, paid calls or shipped UI validation.

### Async browser controller teardown review (base d834e9e)
Controller now captures generation before awaiting failed-release retries; end/dispose invalidates the attempt before any mic acquisition, including delayed retry and synchronous subscriber calls. `end(): Promise<void>` and `dispose(): Promise<void>` share one in-flight teardown: resolve only after late acquisitions and cleanup finish, reject with `Error("resource cleanup failed")` if releases remain unsuccessful. Phase is `error` on rejection, `ended` on success; subsequent end/dispose retries failed closures even if disposed. Callers MUST await/catch a stop (do not treat phase-only failure as success). Internal event-driven fail() catches background cleanup rejections; it reports error state and never fires an unhandled rejection. No API change to start. Offline targeted controller/integration/device tests: 31 pass, 0 fail; Chromium offline adapter run with local google-chrome-stable + playwright-core passed (captureTracksEnded/captureClosed/outputClosed/lateTracksEnded/pendingSocketAborted all true). No provider calls.
