# Live redesign research

## Why restart

User tried v0.7.1 on macOS and says live experience is very poor. Suspects wrong/old model and questions SoX maintenance. Requests current technologies and actual open-source official/reference app research, then reconsider all decisions and remake properly. Do not patch/release more before evidence and design discussion. Keep priority: naturally responsive live talk alongside configured die agent work, CLI inline status, local macOS first. No need preserve flawed internals.

## Known vs unknown

Tag v0.7.1 src/live/transport.ts explicitly sets LIVE_MODEL=gemini-3.8-live. This verifies requested model in source, not what user saw/runtime identity. Coding-agent model vs Live UI confusion is a hypothesis. No physical Mac audio quality test yet; earlier provider tests proved limited wire behavior, not a good conversation. Lack of acoustic processing and channel/context design need fresh review. Do not assume SoX age alone diagnoses poor UX.

## Active read-only research

- task_051143cf: current Google model/protocol/SDK and actual official sample source.
- task_edd8bc18: maintained audio stacks/reference projects; real local AEC/device/packaging tradeoffs.
- task_de24a3a6: current implementation and loop/UX/test gaps.

All use current workspace read-only; no independent code worktrees yet. Use tvly and original source links, exact repo files/commits/dates; distinguish claims from verified facts. No real key reads, paid API, mic or speakers. Parent synthesizes recommendations and measurable acceptance before implementation. Values review pending after synthesis; existing truthful proof/real-user-path guidance already applies.

## Parent verification and disputed finding

Confirmed tag requests gemini-3.8-live. Model label confusion remains a hypothesis, not runtime proof. Research found current official repo google-gemini/gemini-live-api-examples at 3bcae1162d1bc6955672153310e4f84eba6621ff (2026-09-15): native CLI sample plus browser AudioWorklet examples. Python CLI explicitly recommends headphones; PortAudio alone does not solve echo. LiveKit console demonstrates feeding actual rendered output into its audio-processing module. A direct replacement capture library alone would retain the key acoustic gap.

One research report called existing sibling scheduling/willContinue invalid based on guide examples. Parent checked official googleapis/js-genai src/types.ts at d4bcdad45f105a7b4c035872406c04e2d42d63d4: FunctionResponse explicitly includes scheduling and willContinue, describing generator-style responses. Therefore do NOT report protocol invalidity as proven. Sample/guide shape conflicts need SDK/wire reconciliation. Existing overlong tool-response observation channel can still be poor design independent of schema validity.

Sources:
- https://github.com/google-gemini/gemini-live-api-examples/tree/3bcae1162d1bc6955672153310e4f84eba6621ff
- https://github.com/googleapis/js-genai/blob/d4bcdad45f105a7b4c035872406c04e2d42d63d4/src/types.ts
- https://ai.google.dev/gemini-api/docs/live-tools

Proposed direction (not yet user-approved): preserve full-duplex live talk, not push-to-talk as default; official SDK; native macOS voice-processing audio helper prototype; device/permission/echo/interruption acceptance before full integration; visible voice vs work model, transcript, state and latency metrics; task-scoped bridge with clear context/results rather than permanent function-response event bus. No automatic switch to a browser product, hosted framework or new reasoning model.

## Combined findings and next design

All three reviews completed. No runtime code changed. tvly daily unauthenticated cap was reached; researchers continued with original official docs and repository source. Do not claim all evidence came through tvly.

Verified implementation gaps:
- Footer shows coding-agent model but not voice model. Add distinct labels; no model swap needed to meet requested gemini-3.8-live.
- SoX capture/render have no shared echo-processing reference. Default device streams, arbitrary stdout chunks, no measured device/capture/playback latency. Interrupt waits for server then kills/restarts player.
- Input transcript is requested but extension does not consume it. Output transcript not requested. Status mixes mic and speaker amplitude and lacks conversation states.
- Live starts with no bounded project/session context snapshot. Only gets selected session events after first handoff.
- Work updates depend on a lingering tool-call channel. Provider cancellation drops reporting but work continues. Separate real work state from provider call lifetime.
- Fake tests prove packet flow, not meaningful conversation during slow coding work. Prior real acceptance used synthetic speech then text to trigger handoff; not a full voice/agent test.

Do not overstate suspected causes: echo/self-interruption, latency and misheard speech were not measured on user's Mac. User symptoms beyond “awful” still needed. A 96 KB queue limit is a capacity, not proof that all playback always has two seconds of delay.

Proposed remake, not yet approved implementation:
1. Keep full-duplex gemini-3.8-live and configured die agent. No default push-to-talk downgrade.
2. Use official @google/genai, pin/test SDK and Gemini Developer API wire behavior. Raw websocket is valid but own schema maintenance adds care. SDK does not itself fix acoustic or UX issues.
3. Prototype bundled macOS helper using VoiceProcessingIO or supported AVAudioEngine voice processing. Fixed short frames, bounded render ring, immediate flush without process restart, device/error events. Verify actual AEC and packaged mic permissions on Mac before claiming readiness. No blanket promises about Bluetooth or arbitrary device pairs.
4. Use provider VAD first; compare local speech detection on echo-processed audio for faster interruption/end-of-turn only after measuring. Do not gate mic while model talks.
5. Keep a small session work registry independent of function-call IDs. Short task-scoped handoff/status calls, correlated outcomes, bounded context snapshot, confirmed results. Choose tested mechanism for idle-time result injection; cannot simply assume clientContent does not interrupt active speech. Do not introduce persistent scheduler or full LiveKit/Pipecat runtime without need.
6. CLI line shows voice model and real listening/speaking/reconnecting state; offer visible input/output transcript without dumping private tool logs.
7. Establish clean voice-only baseline first, then add real slow agent work, interruption, second request and results. Compare measured distributions for response onset, local playback cut-off, queued audio ms and false interruptions on actual Mac routes. Synthetic/offline checks continue but do not stand in for experience acceptance.

Reference sources:
- Google CLI and browser examples: https://github.com/google-gemini/gemini-live-api-examples (inspected 3bcae1162d1bc6955672153310e4f84eba6621ff, 2026-09-15). Python command-line sample uses PyAudio, concurrent loops, headphones warning. Browser sample requests echoCancellation/noiseSuppression/autoGainControl and AudioWorklet framing. Examples are references, not production-quality proof.
- LiveKit console audio processing: https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/cli/_legacy.py (render-reference processing pattern; inspect current console too before copying).
- Pipecat: https://github.com/pipecat-ai/pipecat (local transport/interruption references; no proposal to adopt full Python framework).
- Apple VoiceProcessingIO: https://developer.apple.com/documentation/audiotoolbox/kaudiounitsubtype_voiceprocessingio
- SDK FunctionResponse source pinned above is authoritative evidence against unsupported-generator claim; schema conflict remains a verification task, not a confirmed bug.

Values: strengthened existing “Finish what user needs” with user-platform/device interaction evidence. This repeated across Linux-only assumptions, protocol-only acceptance, and macOS device-free CI. Applies when physical interaction is central; does not require costly hardware tests for unrelated small edits. No new value added.
