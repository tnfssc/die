# Gemini Live research

Research date: 2026-09-23. This is a design note only. No Live connection was opened, no microphone was used, and no credential value was printed.

## Recommendation

Use Bun's built-in `WebSocket` directly for the first server-side implementation. It adds no transport dependency and this repository already requires Bun >= 1.4.1. The Live wire protocol has four client message envelopes and is small enough for a narrow adapter. Keep that adapter private so it can be replaced if the protocol moves.

Do not add `@google/genai` only to open the socket. It is the official and safest choice if generated request/response types or broader Gemini support become more valuable than size, but it is much larger than a transport: npm reported `@google/genai@2.24.0`, about 11.9 MB unpacked, with `ws`, retry, protobuf, and Google auth dependencies. If Bun's client proves incompatible, the smallest fallback is `ws@8.21.3` (about 151 KB unpacked, no required dependencies). Versions are observations, not pins; recheck at implementation time.

Use the stable model `gemini-3.8-live`. On the raw wire the setup model is `models/gemini-3.8-live`. Use the Gemini API `v1beta` WebSocket endpoint:

`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`

Start with this setup shape:

```json
{
  "setup": {
    "model": "models/gemini-3.8-live",
    "generationConfig": {
      "responseModalities": ["AUDIO"]
    },
    "realtimeInputConfig": {
      "automaticActivityDetection": { "disabled": false },
      "activityHandling": "START_OF_ACTIVITY_INTERRUPTS"
    },
    "inputAudioTranscription": {},
    "outputAudioTranscription": {},
    "tools": [{ "functionDeclarations": [] }]
  }
}
```

The empty declaration list above is a placeholder: omit `tools` until there are declarations. Do not enable extended thinking, affective dialog, proactivity, search, session resumption, or context compression for the first slice. Add each only for a named need. The base model and default thinking behavior are enough for the requested voice/tool loop.

## Wire contract to preserve

1. Open the socket with the API key but never put the complete URL or headers in logs. Send exactly one `setup` message first.
2. Wait for `setupComplete` before sending user input.
3. Send text turns as `clientContent`; send low-latency audio as `realtimeInput.audio` with base64 data and `mimeType: "audio/pcm;rate=16000"`.
4. Input is raw signed 16-bit little-endian PCM, natively 16 kHz. Output is raw signed 16-bit little-endian PCM at 24 kHz. Own and bound an output playback queue.
5. Match every server `toolCall.functionCalls[]` and client `toolResponse.functionResponses[]` by the server-issued `id`; do not match only by function name.
6. Treat `generationComplete`, `turnComplete`, and `interrupted` as different states. An interrupted turn has no `generationComplete`; it proceeds through `interrupted` to `turnComplete`.
7. Handle `toolCallCancellation.ids[]`. Cancel unfinished local work where possible. Never try a side effect again merely because cancellation made its result uncertain.
8. Bound inbound audio, outbound audio, pending calls, and response sizes. Socket close/error owns cancellation and queue cleanup.

The four client envelopes are `setup`, `clientContent`, `realtimeInput`, and `toolResponse`. Realtime audio, video, and text are concurrent streams; ordering across modalities is not guaranteed. Input/output transcript messages are also independent and have no guaranteed ordering, so transcripts must not drive audio queue correctness.

## NON_BLOCKING tool calls

Function calls are blocking by default. Put `behavior: "NON_BLOCKING"` on only declarations whose work may continue while the user and model keep talking. This belongs on the function declaration, not on the invocation:

```json
{
  "name": "long_task",
  "description": "...",
  "behavior": "NON_BLOCKING",
  "parameters": { "type": "object", "properties": {} }
}
```

Return the original `id` and choose response scheduling deliberately. Current official JavaScript examples place `scheduling` inside the response object:

```json
{
  "toolResponse": {
    "functionResponses": [{
      "id": "server-call-id",
      "name": "long_task",
      "response": {
        "result": "done",
        "scheduling": "WHEN_IDLE"
      }
    }]
  }
}
```

Scheduling means:

- `INTERRUPT`: surface the result immediately, interrupting current model output. Reserve this for urgent results; audio playback must obey the resulting interruption signal.
- `WHEN_IDLE`: let current generation/conversation activity finish, then let the result trigger model work. This is the best default for an ordinary completed background task.
- `SILENT`: add the result to context without interrupting or starting model generation. Use for progress/bookkeeping that need not be spoken.

The API schema also supports generator-style NON_BLOCKING responses through `willContinue`. `true` says more responses for the same call ID will follow; `false` closes it. An empty final response can still trigger generation. Pair the final response with `SILENT` when closing must not make the model speak. Do not use this streaming form in the first slice unless visible progress is a real product need.

Keep one owner per call ID. A completion and a cancellation can race. Record a terminal state once, suppress late duplicate responses, and make tool side effects idempotent where feasible.

## Audio interruption

Automatic VAD is enabled by default. Keep it enabled first and keep `activityHandling: "START_OF_ACTIVITY_INTERRUPTS"` explicit. When speech activity starts, the server cancels and discards ongoing generation, retains only content already sent to the client, reports `serverContent.interrupted: true`, then completes the turn. On that signal the client must immediately stop the audio device and empty all queued, not-yet-played 24 kHz audio. Merely stopping new chunks still plays stale speech and makes barge-in appear broken.

With automatic VAD:

- stream audio continuously as `realtimeInput.audio`;
- when input pauses for more than about one second because capture stopped, send `realtimeInput.audioStreamEnd: true` to flush cached audio;
- later audio reopens the stream;
- do not send `activityStart` or `activityEnd`.

For push-to-talk, instead set `automaticActivityDetection.disabled: true`, send `activityStart: {}`, stream audio, and send `activityEnd: {}`. Do not mix manual markers with automatic VAD. A later hybrid mode can retain automatic VAD and use `audioStreamEnd` to finalize input sooner, but it is not needed first.

`NO_INTERRUPTION` intentionally disables barge-in. It is not a fix for playback races. Also stop/clear playback on local user-activity onset as a latency optimization, while retaining the server `interrupted` message as authoritative for conversation state.

## Credential path

The repository's pinned Pi 0.87.1 auth storage is `Record<providerId, Credential>`, one credential per provider. The two canonical forms are:

- API key: `{ "type": "api_key", "key"?: string, "env"?: Record<string,string> }`
- OAuth: `{ "type": "oauth", "refresh": string, "access": string, "expires": number, ...providerFields }`

The Google provider ID is `google`; its ambient variable is `GEMINI_API_KEY`. The active `~/.die/agent/auth.json` was inspected only through a metadata-only shape report (field names, primitive types, and lengths); no value was emitted. It currently has no `google` entry. The storage implementation already provides file locking, serialized `modify`, OAuth refresh safety, runtime overrides, and non-secret `listCredentials` metadata.

The eventual integration should not parse `auth.json` itself. Create the existing `ModelRuntime` against `~/.die/agent/auth.json` and call `getAuth("google")`; use only `result.auth.apiKey` in the connection owner. This also honors a stored `google` API-key credential and the provider's normal ambient auth rules. Never send that key to the browser. If a browser owns the Live socket later, mint a short-lived ephemeral token server-side instead.

Before that integration, a small `live.env` loader is acceptable as an explicit bridge:

- fixed path `~/.die/agent/live.env`; do not search the repository or current directory;
- one supported assignment, `GEMINI_API_KEY=...`; blank lines and `#` comments may be allowed, but do not run a shell, variable expansion, command substitution, or a general dotenv package;
- use `lstat`; require a regular file owned by the current uid, reject symlinks, and reject any group/other permission bits (require mode 0600 or stricter);
- cap file size (16 KiB is ample), reject NUL, duplicate keys, empty values, and multiline values;
- return the key to the connection owner without mutating `process.env`;
- errors may name the path or missing variable, never the value; redact socket URLs, query strings, setup dumps, and exception causes that may include credentials;
- add `live.env` to ignore rules before documenting it, and migrate/delete it after normal `google` auth is available.

A server-side raw WebSocket commonly authenticates with the Gemini API key on the connection. Follow the official tutorial's chosen query/header form at implementation time and add a test that logging cannot expose it. Prefer a header when the runtime supports it reliably; otherwise a query parameter is workable only if the complete URL is never logged.

## Evidence

Official Google sources found and extracted with `tvly`:

- Live API overview and transport choice: https://ai.google.dev/gemini-api/docs/live-api
- Capabilities, PCM formats, VAD, interruption handling, JavaScript examples: https://ai.google.dev/gemini-api/docs/live-api/capabilities
- Tool use and asynchronous function calling: https://ai.google.dev/gemini-api/docs/live-api/tools
- WebSocket protocol/reference: https://ai.google.dev/api/live
- Session lifetime/resumption: https://ai.google.dev/gemini-api/docs/live-api/session-management
- Current stable model card: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- Browser/ephemeral-token and transcription examples: https://ai.google.dev/gemini-api/docs/live-api/live-transcribe

Other evidence:

- npm package metadata: https://registry.npmjs.org/%40google%2Fgenai/latest and https://registry.npmjs.org/ws/latest
- local pinned API declarations: `@earendil-works/pi-ai@0.87.1/dist/auth/types.d.ts`, `@earendil-works/pi-coding-agent@0.87.1/dist/core/auth-storage.d.ts`, and `model-runtime.d.ts`
- local provider declaration: `@earendil-works/pi-ai@0.87.1/dist/providers/google.js`
- project context read: `wisdom/values.md`, `wisdom/dependencies/pi-0.87-upgrade.md`, `wisdom/quality/diagnostics.md`, and `wisdom/web/die-web-upgrade-auth.md`

## Limits and checks still needed

- This was documentation/protocol research only. There was no paid connection, API call, microphone capture, speaker playback, or latency/echo test.
- Tavily's keyless hourly cap stopped one final targeted extraction. Existing successful extracts included all cited official pages and the needed scheduling/audio passages; no payment or credential fallback was used.
- The exact raw authentication option supported by Bun's WebSocket client must be verified without logging the key. Official browser examples favor ephemeral tokens; a permanent API key must remain server-side.
- Confirm raw enum/field casing against a captured SDK request or a schema fixture before the first network test, especially `FunctionResponse.response.scheduling` and `willContinue`.
- Audio barge-in still needs a deterministic test with synthetic PCM and a fake socket: queue audio, deliver `interrupted`, and prove playback stops and the queue becomes empty. Echo cancellation is an application/audio-device concern, not supplied by this protocol.
- Live sessions are stateful and finite. A production path will need `goAway`, reconnect, and session-resumption policy, but those should not enlarge the first connection slice.
- Model names and preview/stable status change. Recheck the model page and package registry at implementation time.

## Decision

Build the first slice as one server-owned raw Bun WebSocket, one bounded playback queue, automatic VAD with barge-in, and NON_BLOCKING tools defaulting completed results to `WHEN_IDLE`. Use strict `live.env` only as a short bridge, then resolve provider `google` through the existing `ModelRuntime`. This is the fewest new parts while preserving interruption, cancellation, and credential ownership.
