# Dual-provider web integration phase — 2026-09-25

**Status: incomplete and not production-ready. No shipped route or UI enabled.** Both provider adapters and actual browser-device loopback proof exist, but this is not the requested complete vertical web feature. No change to canonical integrations/t3/upstream/die.patch was made; no maintained T3 web build or actual T3 route tests were run. Do not claim those from isolated module bundles or the browser loopback test.

Main worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_37ea736e
Branch: die/implement-dual-provider-web-live-integra-37ea736e
Base: f5cdc525104c30ed33dec147af495ade8165feef. Parent-approved foundation fixes 23f996e and 1b0bc4a are integrated as 5b72165 and 97ff4b9; foundation owner files were not otherwise edited. Parent handoff remains untracked and untouched.

## Transport decision and delivered seams

Current public network docs verified without credentials/paid calls: [sources and exact caveats](web-provider-public-docs.md). Gemini ephemeral browser Live uses PCM/WebSocket; no documented Gemini Opus/WebRTC found. OpenAI Realtime supports WebRTC + trusted sideband but browser session/conversation mutation is documented. Public docs do not establish the browser capability restriction needed to treat shared provider events as authoritative current-host captured input. This is not a demonstrated provider exploit. Choose server-owned sessions for BOTH; raw browser PCM/control only, no tool events, provider credentials or provider sessions browser-side.

- e7330d4 public docs.
- b9a41dc + 3920725: new web provider factory, actual GA OpenAI Realtime item-correlated authority; relay display transcript callback suppressed so it cannot authorize twice. Bounded raw Gemini Developer API WS LiveAdapter reuses VoiceSession, avoiding hidden SDK upstream queues; no private SDK mutation. Gemini wire mapping is documented against pinned SDK 2.24.0. Production provider connectivity remains untested.
- 13ee407 + 7185c20 + 013a130: real AudioWorklet resampling, PCM playback, WS adapters, fake-browser unit tests and opt-in real Chromium fake-media loopback harness. No animation loop.
- 13a89b3: owning SessionHost.lease(), revocation checked again after async preparation/confirmation, per-lease request namespace with shared host capacity, independent unsubscribe, no host/job shutdown. Integration corrected 128-character request IDs via hashing and isolated async tests from shared transcript snapshot storage.

## Concrete authority and lifecycle blockers

1. Canonical T3 owner bridge is missing. Pinned upstream PiAdapterV2.openSession (~524–570) owns input.threadId/providerSessionId and makePiRpcConnection spawn scope. PiRpc exposes Pi JSONL request/send/events, not a Die SessionHost capability. host-access.ts is an in-process extension bus, not IPC. Neither a browser thread ID nor a session-file path is authority. A private per-process-generation sideband must be bound by that spawn scope, not the discovery child (~2939). Authenticate exact-Origin upgrade, bind to authorized connection + exact thread/process generation, resolve server-side key in owner process, and revoke on switch/disconnect/end/process replacement before exposing it. Do not inherit generation secrets to arbitrary tool children, synthesize browser-selected Pi tool requests, or auto-confirm permissions. This is missing security integration, not proof that such a bridge is impossible. Research worker's older Gemini/lease blockers are now superseded; the bridge itself is still absent.
2. Controller Capture.stop/AudioOutput.stop/Transport.close remain synchronous. Actual AudioContext.close and socket handshake are asynchronous. Direct adapter test awaits audio closed promises and observes peer closure, but controller cannot report verified release from these contracts. Parent coordination requested before changing foundation-owner files. Capture cleanup currently marks stopped before all teardown succeeds; throwing real adapters need retry ownership.
3. Provider pending-setup teardown is not fully proved: VoiceSession adapter connect lacks a cancellation signal. A Gemini connect ended before setup can retain its underlying WS until setup/deadline; close() after ready enqueues a handshake rather than awaiting closure. Need explicit provider-transport abort/verified teardown, not just stale-callback suppression.
4. AudioWorklet MessagePort transfer queue is not explicitly acknowledged/bounded. Browser WS/audio scheduled queues are bounded but a stalled main thread can accumulate worklet messages. Add bounded acknowledgements and an explicit capture error contract; do not silently drop or turn overflow into inert capture during connecting.
5. Gemini upstream hard queue cap is 256 KiB (all JSON traffic), not a 200ms latency promise. Browser/output/socket/kernel/provider buffers are separate. Validate actual provider pacing/bursts and closure; current bounded burst relay can still reject normal large provider output.

These prevent activation. No inert button was added. A safe route/IPC change must be atomic with these lifecycle fixes and actual auth/origin/stale-generation route tests, then encoded in canonical die.patch and built through maintained build:web.

## Verification and resource evidence

Integration offline suite initially 65 pass / 0 fail / 599 assertions across 11 selected live files; full TypeScript check passed after asset preparation. After lease test hardening: **66 pass / 0 fail / 603 assertions**. Initial final typecheck caught an unknown-error test cast; corrected and typecheck rerun. Actual Chromium harness rerun from integrated branch: 29 frames / 18,560 upload payload bytes; 9,600 download payload bytes; 48kHz fake capture context resampled to 16k; interruption queue 9600→0; late/normal track cleanup, direct audio close and peer-observed WS closure passed. Source bundle built via Bun in that test. This is a real adapter loopback endpoint, **not the shipped route**, no actual mic or acoustic quality acceptance.

Estimates: browser continuous PCM16 mono input16k = 32,000 B/s = 1.92 MB/min; output24k = 48,000 B/s = 2.88 MB/min; full duplex4.8 MB/min payload excluding framing/TLS. Server/provider base64 expands audio approx4/3, plus JSON/TLS. CPU, memory, idle paint/animation and real-provider latency not measured; no PCM performance victory claimed. No web cost UI added (parent clarified accounting is separate CLI-only work).

## Worker provenance

All implementation workers use durable worktrees under the main path prefix plus -a86675007a5e-task_SUFFIX, each retained:
- e39e3f4b public docs; branch die/verify-public-dual-provider-transport-an-e39e3f4b; original33fb6cf.
- 79523975 device adapters; branch die/implement-browser-pcm-device-adapters-79523975; original94a56c1.
- 7f82bd0b factory; branch die/audit-real-openai-relay-compatibility-7f82bd0b; original85e7ace.
- 60306d6c lease; branch die/owner-bound-revocable-sessionhost-voice--60306d6c; original9905dfb.
- c148b96c Gemini adapter; branch die/resolve-gemini-bounded-upstream-adapter-c148b96c; original1cece8c.
- 1c82c59f Chromium; branch die/actual-offline-chromium-adapter-loopback-1c82c59f; originalf6d7e34.
- d2079809 IPC investigation (no code/patch); branch die/implement-canonical-trusted-pi-voice-ipc-d2079809; original2308ee0 NOT picked because its lease/Gemini dependency blockers are superseded. It inspected a disposable upstream source copy, made no code edits there.
- 3d4afbfc initial seam research; branch die/find-canonical-web-route-and-owner-ipc-s-3d4afbfc; no commit.

Values read and unchanged: existing clear ownership, bounded resources, truthful evidence and safe-work preservation cover these findings. Paid provider/microphone acceptance remains pending explicit user approval.
