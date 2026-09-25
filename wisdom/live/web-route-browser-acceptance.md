# Canonical web Live browser acceptance (in progress)

The adapter-only loopback test (`tests/browser/live-adapter-offline.ts`) is **not** acceptance of the shipped route. The browser gate must load the packaged canonical UI from the patched upstream server and open its authenticated voice route, with the owning Pi private IPC channel backed by a fake Gemini/OpenAI provider. Never call paid APIs or physical microphone. Fake Chromium media-device flags supply PCM.

Instrumented browser probe is `tests/browser/live-route-probe.ts`: it records browser microphone permission requests/track stop, the real route WebSocket lifecycle and binary upload/download payload bytes. Pre-click permission requests must be exactly zero. For each provider: wait for visible ready, assert PCM upload bytes nonzero, mute then end and ensure no surviving socket/track; provider/thread switch must revoke the previous owner. Missing-credential path must show an actionable error without granting media. Route tests also assert unauthorized origin/stale-owner rejection server-side.

The canonical route, controls, provider fake dependency seam and FD3/FD4 upstream→root private IPC are being implemented in parallel. No route browser test has passed yet. Local `bun run check` passed after using the parent worktree's already installed `node_modules`, with no real devices or provider calls. PCM estimates only: 16kHz mono PCM16 upload ~32,000 bytes/sec; 24kHz mono PCM16 download ~48,000 bytes/sec, excluding framing and provider/base64 overhead. No CPU, paint, animation or audio quality claim until measured.

## Opt-in gate command (server/fixture seam pending)

`DIE_CHROMIUM=/home/tnfssc/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome DIE_PLAYWRIGHT_CORE=/home/tnfssc/Code/manuscript-review/node_modules/playwright-core DIE_LIVE_BROWSER_URL=http://127.0.0.1:<port>/<active-thread> DIE_LIVE_BROWSER_MISSING_URL=http://127.0.0.1:<no-key-port>/<active-thread> DIE_LIVE_BROWSER_WS_PATH=/api/voice/ws DIE_LIVE_BROWSER_FAKE_IPC_EVIDENCE=/tmp/<fixture-evidence>.json bun run test:browser:live-route`

The fixture must run the **canonical patched server and UI** with an already created thread, fake root private FD channel that counts provider starts and reports `{ "providers": ["gemini", "openai"], "paidCalls": 0 }`, plus an isolated missing-credentials instance. The browser test refuses any substitute WS route. Until that setup exists, a syntax/typecheck pass is **not** browser acceptance.
