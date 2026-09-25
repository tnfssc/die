# Canonical web Live browser acceptance

The adapter-only loopback test (`tests/browser/live-adapter-offline.ts`) is **not** acceptance of the shipped route. The browser gate mounts the actual upstream component and Effect route, with a fake owning Pi private IPC peer; it does not use the full upstream shipped web build. Never call paid APIs or physical microphone. Fake Chromium media-device flags supply PCM.

Instrumented browser probe is `tests/browser/live-route-probe.ts`: it records browser microphone permission requests/track stop, the real route WebSocket lifecycle and binary upload/download payload bytes. Pre-click permission requests must be exactly zero. For each provider: wait for visible ready, assert PCM upload bytes nonzero, mute then end and ensure no surviving socket/track; provider/thread switch must revoke the previous owner. Missing-credential path shows an actionable error and promptly stops fake media. Route tests also assert unauthorized origin/stale-owner rejection server-side.

The offline gate passed against the upstream checkout using a protocol-only fake Pi subprocess. PCM estimates only: 16kHz mono PCM16 upload ~32,000 bytes/sec; 24kHz mono PCM16 download ~48,000 bytes/sec, excluding framing and provider/base64 overhead. No CPU, paint, animation or audio quality claim until measured.

## Executed offline Chromium gate (2026-09-25)

Run: `DIE_T3_SOURCE=/path/to/canonical/t3code bun run test:browser:live-route`. Optional DIE_CHROMIUM and DIE_PLAYWRIGHT_CORE override local Chromium/Playwright defaults. The runner owns fixture and browser lifetimes; no external server setup.

The fixture imports upstream canonical /api/voice/ws into Effect NodeHttpServer and Bun-bundles upstream actual VoiceControls. Fake auth/owning thread projection; real PiVoiceChannels FD3/FD4 subprocess wiring with deterministic protocol peer (no SDK/network), stop ACKs, ready/status, raw PCM and missing-key error. Chromium uses fake media switches; no physical microphone.

Passed: `DIE_T3_SOURCE=/home/tnfssc/.die/worktrees/die-a86675007a5e-task_6394ca7b-a86675007a5e-task_86494437/.cache/die-t3code-b488c57f3f9f1688e31c53daee99e29dd1d0baa2 /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun tests/browser/live-route-run.ts` exit 0. Gemini/OpenAI each: 3 sockets opened/closed, 3 fake microphone tracks acquired/stopped across provider/thread switches and explicit end; at least 3205 uplink bytes in 5+ binary frames, each 2880 binary downlink bytes in 3 frames. Pi peer received at least 6400 raw PCM bytes, 6 stop ACKs, both providers, paidCalls=0. Missing-key page showed actionable error and stopped media. Real network HTTP route rejected absent/evil Origin (403), unauthorized/read-only (401), malformed thread (400), stale owner (409).

Limitation: fake Pi subprocess speaks actual FD protocol but does not execute root attachWebVoiceIpc or provider SDK; no CPU, paint, audio-quality or paid API claim.

Scope: actual production VoiceControls component in fixture HTML + production route, not complete packaged application. PCM upload report excludes one-byte canonical binary kind prefix per frame. New stop-ACK changes require a revised gate run before final acceptance.
