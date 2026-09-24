# Explicit Live models and GPT-Live design gate (2026-09-24)

The selection-only gate below is historical. Actual independent adapter/bridge/native wiring now exists; see [current implementation evidence and parent-review handoff](gpt-live-implementation.md).

Baseline 9023d41111c7cc25a0be2e9b1085dfc175faa7bc: retain interrupted-response completion fixes and Mac audio graph. Read values, OpenAI research/provider/integration notes and Mac current speaker audit. No publication, provider calls, secrets or devices.

## Independent official evidence

Attempted tvly CLI advanced search: daily_cap_reached (keyless quota), no search results. No payment/auth bypass. Direct HTTPS retrieval of official sources succeeded independently of researcher task102265d2:

- https://developers.openai.com/api/docs/models lists all three exact IDs.
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini names **gpt-realtime-2.1-mini**, GPT-Realtime-2.1 Mini. Free tier unsupported. Not an alias invented for gpt-realtime-mini.
- https://developers.openai.com/api/docs/models/gpt-live-1 names **gpt-live-1**.
- Existing Realtime stays **gpt-realtime-2.1**.
- https://developers.openai.com/api/docs/guides/voice-websockets?api=live documents **wss://api.openai.com/v1/live/sessions**, no model query, Bearer API key, session.start then session.started; session.model/audio/delegation fixed at startup. Input session.input_audio.append, output session.output_audio.delta. Mono PCM16LE 24 kHz default or 16 kHz, same format both directions, continuous paced base64 raw samples. NOT Realtime session.update or response.output_audio.delta.
- https://developers.openai.com/api/docs/guides/live-delegation documents client mode, avoiding an invented extra paid Responses model. session.delegation.created contains ID/target/offset_ms, **no task text**. App retains conversation/permissions. Results session.commentary.append; quiet progress session.thinking.append, original delegation ID. Transcript fragments explicitly are NOT complete user turns.
- https://raw.githubusercontent.com/openai/openai-node/master/src/resources/live/live.ts and https://raw.githubusercontent.com/openai/openai-node/master/src/resources/live/sessions.ts confirm distinct types. Output transcript delta has no transcript-done event. Primary WebSocket output audio omits timing, unlike sideband. Live ServerEvent union has no Realtime response IDs, speech_started, output-audio-done or truncate events.

Shared WebSockets guide contains both API tabs; later /v1/realtime examples are not conflicting Live instructions. Catalogue is not account entitlement/quota proof.

## Design gate, not unavailable model

Raw Bun WebSocket plus existing streaming resampler can carry GPT-Live PCM. Official JS sample uses openai + ws; new dependency/native audio backend is not inherently needed. WebRTC WOULD need a peer/audio-track bridge and materially touch proven Mac audio: do not introduce speculatively.

Current VoiceProvider/VoiceOrchestration assumes completed user-transcript authority, model tool names/arguments, interruption epochs and turn completion. Client delegation supplies none of those exact boundaries. A fragment/delegation offset is not automatically complete speech. Transcript arrival is not a documented queue-clear event. Inventing either undoes existing authority/barge-in safeguards. Backend jobs must survive spoken interruptions.

Proposed path: retain native audio, independent GPT-Live PCM WebSocket provider, client delegation through existing agent/current-session bridge with separately reviewed transcript/delegation authority boundary. Keep timestamps/context without falsely marking fragments final; return commentary/thinking under delegation ID. Need authoritative guidance/design decision on output-queue interruption and transcript authority before claiming tool/barge-in parity. If not preservable, evaluate WebRTC bridge as separately approved audio-backend project. No fallback/substitution.

Proceed independently on explicit persisted selection and both Realtime model parameters. Interim GPT-Live selection must report unavailable IN THIS BUILD until genuine protocol/bridge implementation lands; not claim model unavailable. This does NOT complete requested GPT-Live support.

## Durable work and gaps

Parent worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d96f1bf2.
Selection worker task_4f7992db, branch die/persist-explicit-live-model-choices-4f7992db, worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d96f1bf2-a86675007a5e-task_4f7992db. Owns config/selection/model parameter and tests, not native/protocol rewrite.

Pending: merge/review selection tests, existing 97 focused regressions/wider Live suite, exact mini wire model tests, persistence/default/no-substitution tests. GPT-Live transport/tools/lifecycle/barge-in/transcript integration not implemented or tested at milestone. Paid/device/account proof intentionally unrun. Values unchanged: existing evidence, authority-boundary, preservation and design-change rules cover this case.

## Selection milestone integrated

Worker commit 06a61092e4b1db38af75256b3be062d3587c24a4 integrated as bd8a3e0. /live provider google|openai and /live model choose exact model; persisted atomically in ~/.die/live-settings.json. Missing settings preserve Gemini default; invalid settings fail visibly rather than reset choices. Switching providers remembers prior OpenAI choice. GPT-Live selection persists but startup/setup stop before key/audio access with explicit unsupported-in-this-build notice. This is an honest design gate, not completed GPT-Live support.

Realtime WebSocket URL uses exact selection (full/mini), labels use selected model, and explicit insufficient_quota/rate_limit_exceeded/model_not_found/invalid_api_key events now produce fixed sanitized guidance mentioning that model. Unknown messages remain redacted; no fallback or reconnect substitution. Provider status_details errors use the same classifier; pre-handshake network/HTTP failures may remain generic because Bun WebSocket error events do not prove quota or model eligibility.

Verification: installed frozen lockfile using existing Bun 1.4.2 executable, without trusting mise config. 217 passed / 2 paid acceptance skipped across 26 Live/OpenAI files after selection integration; following narrow error-classification change, 101 focused protocol/extension/playback tests passed, 20,586 assertions. Typecheck and diff --check passed. Native/, audio.ts, playback.ts, resampler and Gemini session.ts unchanged from 9023d41. No paid/key/device tests. GPT-Live transport, authorization/tool bridge and barge-in remain unimplemented pending parent design review; do not present the three selectable IDs as three working transports.
