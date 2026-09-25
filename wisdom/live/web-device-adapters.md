# Browser device adapters — offline seam

Read values.md and web-port.md. This task owns only web/live/device-adapters.ts and its dedicated test, not controller/protocol or shipped UI. Capture uses an AudioWorklet with actual context sampleRate and weighted integration to 16k PCM16LE 20ms frames. Output schedules 24k native audio nodes against the audio clock, bounds playout at 250ms, and stops nodes on interruption. Socket uses existing relay codec, same-origin path, binary PCM and bounded outbound bufferedAmount; no provider keys. No idle animation/poll loop.

Contract mismatch: Capture.stop() and AudioOutput.stop() are sync void in controller, but AudioContext.close() is async. Adapters stop tracks/nodes synchronously and initiate close, exposing a closed promise for direct verification, but controller does not await it and may report ended before device release is verified. Parent should make cleanup awaitable to claim verified release. WebSocket.close() also starts an asynchronous closing handshake.

Tests use fake browser APIs for clock playout/interruption, late permission cleanup, codec, binary copy and aborting socket handshake. Local TypeScript source compilation passed. Bun executable was unavailable in this worktree shell; adapter Bun tests were written but not run. No real browser/acoustic measurement, secrets or provider calls.
