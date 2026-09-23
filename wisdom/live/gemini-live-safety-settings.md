# Gemini Live safety settings

Checked 2026-09-23 for the raw Gemini API WebSocket used by `src/live/transport.ts`.

## Result

Do **not** send `safetySettings` in the Live setup. The current transport uses stable `gemini-3.8-live` through the v1beta `BidiGenerateContent` WebSocket. Google's current model card says that exact model supports the Live API, but the canonical `BidiGenerateContentSetup` schema does not contain a `safetySettings` field. Its documented fields are model, generation config, system instruction, tools, realtime input config, session resumption, context-window compression, input/output transcription, proactivity, and history config. The Live generation-config entry also does not make safety settings part of generation config. Copying a `GenerateContent` field into either location would be an unsupported wire field.

The separate safety-settings guide documents adjustable filters for harassment, hate speech, sexually explicit content, and dangerous content. It documents `OFF` as “turn off the safety filter” and `BLOCK_NONE` as “always show regardless of probability,” and says Gemini 2.5 and 3 default to Off when a threshold is omitted. However, its examples and response semantics are explicitly for `GenerateContent`; this is not evidence that a Live `BidiGenerateContentSetup` accepts the same request field. We therefore do not claim that omission explicitly configures Live to `OFF`, even though it is the only valid current setup.

Google also states that built-in protections for core harms, including child safety, are always blocked and cannot be adjusted. Nothing here changes those platform protections. Nothing changes die's single `handoff` tool, approvals/permissions in the configured agent, or the Live prompt boundary that treats bridge text as data rather than instructions.

## Evidence

Official Google pages retrieved with `tvly` and checked against their current text:

- Live WebSocket schema: https://ai.google.dev/api/live and https://ai.google.dev/api/live.md.txt
- Current model card (stable model code, Live support; updated 2026-09-15): https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- Safety categories, thresholds, defaults, mandatory core-harm protections, and GenerateContent examples: https://ai.google.dev/gemini-api/docs/safety-settings

No real API call was needed or made: the canonical setup schema is decisive, and a rejection probe would not establish supported semantics. No credential file or account setting was read or changed. Offline regression coverage in `tests/live-transport.test.ts` verifies the exact model, absence of a safety field in both possible copied locations, and retention of the handoff/prompt boundaries.

## Recheck trigger

Revisit only when Google's **Live/BidiGenerateContentSetup** reference adds a safety field and the target Live model documents support. Verify exact field placement, allowed categories, and accepted threshold for that model before changing the wire object. Do not infer support from `GenerateContent`, an SDK type for another endpoint, or Google AI Studio.
