# Offline real Chromium adapter proof (opt-in)

Run from the repository root after installing dependencies:

```sh
DIE_CHROMIUM=/path/to/chrome DIE_PLAYWRIGHT_CORE=/path/to/playwright-core bun run test:browser:live-adapters
```

Requires Bun, Chromium, playwright-core (not installed by the main package), loopback binding and fake-media flags. The script bundles the actual adapter and relay codec with Bun.build, serves a click-to-start page and a real loopback WebSocket, and launches headless Chromium. No physical microphone, provider, keys, cloud connection, shipped T3 UI or pre-click permission request. It checks real AudioWorklet capture, PCM16 640-byte frame sizes and binary socket uplink, 24k output playout queue and interruption clear, both audio-context close promises and initial/late-abort stream track release, browser socket abort before handshake, and server-observed closing handshake. No polling/idle animation in the adapter: the test uses a bounded wait solely to collect fake-device audio.

Measured local run (Chromium 1228, fake-device 48,000 Hz context, 650 ms collection): **29 frames / 18,560 bytes** reached the relay. Each frame represents 20 ms / 320 samples at 16 kHz (640 bytes). 29 frames represent 580 ms of captured signal rather than the idealized 650 ms / 20 ms = 32.5 frames; startup, worklet scheduling and permission account for the difference. Relay downlink sent **9,600 binary bytes** (200 ms / 4,800 samples at 24 kHz), decoded by the browser; the output queued 9,600 bytes before interruption and zero after clear. Another run measured 28 frames / 17,920 bytes. These are real observed payload counts, not a throughput or audio quality guarantee. Fake microphone's first PCM samples were zero; this does not establish audible speech fidelity.

Earlier adapter fake-browser tests pass 4 tests / 27 assertions. TypeScript check succeeds after running `bun scripts/prepare-assets.ts`. The initial check without assets reported missing generated runtime-assets; `bun run prepare:assets` fails when Bun is invoked via absolute executable but is absent from PATH. Neither is an adapter defect. Browser test found no further adapter bug requiring a fix.

**Lifecycle limit:** Direct proof awaits adapter `closed` promises; the foundation controller's synchronous stop contract does not await AudioContext.close(), and WebSocket.close() starts an asynchronous closing handshake. Thus controller-reported ended cannot claim verified release. The relay is a test endpoint, **not shipped T3 route acceptance**. Test deliberately avoids editing the controller (pending ownership of awaitable teardown).
