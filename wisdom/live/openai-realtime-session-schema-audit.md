# Realtime GA setup schema audit — 2026-09-24

Read [values](../values.md) and [connection diagnostics](openai-realtime-connect-diagnostics.md). Fresh 0.11.0 report: gpt-realtime-2.1-mini reaches the WebSocket and receives a provider session error. This is **session configuration rejection**, not evidence of a failed HTTP upgrade. Do not send the user through another account/key guess based on connect_failed.

## Direct official evidence

Fetched unauthenticated on 2026-09-24:
- https://developers.openai.com/api/reference/resources/realtime/client-events
- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
- https://raw.githubusercontent.com/openai/openai-node/master/src/resources/realtime/realtime.ts

Audit of every initial field in src/live/openai-session.ts:

| Sent field | Official schema / actual source finding |
| --- | --- |
| event type: session.update; session.type: realtime | Supported GA event/session discriminator. |
| instructions | Supported string; actual value is the existing Live system instruction. |
| audio.input.format.type: audio/pcm; rate: 24000 | Supported; 24000 is the only PCM rate. |
| audio.input.transcription.model: gpt-4o-mini-transcribe | Supported transcription model. ASR is asynchronous; this audit does not change transcript authority. |
| audio.input.turn_detection.type: server_vad; create_response: true; interrupt_response: true | Supported ServerVad fields. |
| audio.output.format.type: audio/pcm (initially no rate) | Offline SDK/guide made omission appear valid; **overruled by the bounded real mini provider rejection documented below**. Output rate 24000 is now sent. |
| audio.output.voice: marin | Listed built-in voice, recommended alongside cedar. Mini is listed as a Realtime model. No fetched source establishes a mini-specific marin exclusion. A successful mini+marin session is not proven offline. |
| output_modalities: [audio] | Supported/default audio output with transcript. Not the unsupported simultaneous text+audio modality array. |
| tools[].type: function; name; description; parameters | Correct flat Realtime envelope, not Chat Completions nested function objects or Gemini parametersJsonSchema. Actual six names: session_context, agent_send, agent_steer, jobs_list, jobs_inspect, job_cancel; all simple valid identifiers, not generic execute/shell tools. |
| tool JSON Schemas | Actual object schemas use properties, required, additionalProperties:false. id/requestId are bounded strings; cursor uses string/integer anyOf; count/offset use integer bounds. No uppercase Gemini schema types or invalid actual names found. parametersJsonSchema is translated to parameters. |
| tool_choice: auto | Supported; permits tool calls rather than requiring one. |

**At the time of the offline audit no initial-payload config defect was established; see the real-provider finding below.** Leave the documented payload unchanged rather than claiming that adding an optional rate fixes the user's rejection. The grounded defect fixed here is blindness: raw provider errors were replaced by a generic withheld-details line even when safe code/type/field were available. The actual provider rejected field from this user's run is still unknown. Offline checks do not prove remote acceptance or the user's audio experience.

## Changes and proof

Realtime-only diagnostics now add finite allowlisted code/type and structural param fields (bounded input length and bounded tool array index, bracket or dot notation). They never echo arbitrary provider messages, property names, headers, URLs, keys, prompt values or unknown tokens. Existing friendly error diagnoses remain, with safe metadata appended. Both setup/event errors and response failure errors use the formatter. Other providers, control, transcription and audio behavior are untouched.

A strict Zod fixture validates the **subset die emits**, using actual orchestration declarations, before acknowledging setup for both exact Realtime model IDs. Originally it accepted the documented optional output PCM rate omitted or 24000; the real-provider finding below supersedes this and the fixture now rejects omission and wrong rate, legacy top-level audio format, invalid tool name/schema, mixed modalities, invalid tool choice and transcription config. These are mutation tests of the fixture, not fabricated recordings from OpenAI. The rejection path proves no ready callback and useful safe rejected-field reporting. Existing transport and session tests still run; no user key reads, paid requests or device tests.

Tests: bun test tests/openai-session*.test.ts (48 tests); bun run check. No release; parent review required.

Main worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_27010d9c (branch die/fix-rejected-openai-realtime-session-con-27010d9c).
Diagnostics worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_27010d9c-a86675007a5e-task_2f628b3f (branch die/safe-openai-provider-diagnostics-2f628b3f), original commit 8ac869ae8d1f4496107904155ee86c330ba53246, integrated then refined in main worktree.

Values unchanged: existing “say what proof shows,” privacy and whole-path verification principles cover this; do not promote a conjecture to a config diagnosis.

## Bounded real provider setup verification (2026-09-24)

With explicit user authorization and a private owner-only regular nonsymlink ~/.die/openai-test.env, ran the gated script scripts/probe-openai-realtime-setup.ts. It parsed the key in memory; no key, raw response, headers or transcript was printed or saved. One production-adapter/default-transport session with the actual six orchestration tools, gpt-realtime-2.1-mini, no audio and no response.create: the handshake succeeded, then setup was rejected with code missing_required_parameter, type invalid_request_error, field session.audio.output.format.rate. This **overrules the earlier offline SDK/guide inference**: the remotely exercised mini setup in fact requires output PCM rate even though published types mark it optional. Added rate: 24000 only to the output format and changed the offline fixture to reject omission. One permitted same-model followup session: WebSocket upgraded and session.updated accepted. Both sessions were closed after setup; no audio or model response was requested. No other model or endpoint tested, no account/quota error seen. This proves mini setup acceptance for this credential on this date, not audio behavior, full-model acceptance or future provider behavior. No auth changes or publication.

Values unchanged: the existing rule to prefer real-path evidence over documentation-based conjecture, preserve privacy, and distinguish handshake from setup already captures the lesson.
