# Live voice in the web UI

- Talk with Gemini Live or OpenAI Realtime from the web UI. Choose the provider, start the microphone, mute, or end voice without stopping coding work.
- Voice stays bound to the owning coding session. Provider keys stay on the server. Thread changes, lost connections, and failed cleanup revoke voice access and show a clear state.
- Browser audio uses binary frames and bounded queues. Mute stops microphone uploads. There is no per-frame UI animation loop.
- CLI session costs now include provider-reported live voice usage. Pending or incomplete charges are marked rather than shown as a complete total. Coding-agent costs remain separate inputs to that total.

## Limits and checks

Voice uses server-owned PCM connections for both providers. Continuous two-way browser audio is about 4.8 MB/minute of payload, before network framing; this is not an Opus-level bandwidth improvement. Real-provider latency, server CPU/memory, and acoustic quality still need measurement.

Checks cover the shipped controller and controls, authenticated route, private coding-session bridge, fake-provider Chromium audio, packaged assets, and compiled CLI entrypoint. Physical microphones, paid provider calls, and a full active-session walkthrough in the packaged app have not been validated. Use localhost or HTTPS for browser microphone access. Starting voice with configured API keys may incur normal provider charges.

[UI screenshots](https://github.com/tnfssc/die/tree/v0.12.0/docs/screenshots/web-live) show the canonical controls in a labeled offline fixture, not a full-app conversation or real call.

## Update

Run `die update`, restart die, then check `die --version` reports `0.12.0`. Run `die web` and use **Start voice** in a coding session. Existing API keys remain server-side; do not paste keys into chat.
