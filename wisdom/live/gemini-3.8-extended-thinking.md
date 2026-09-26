# Gemini 3.8 Live Extended Thinking (2026-09-26)

Google's stable model ID is `gemini-3.8-live-extended-thinking`, not a thinking setting on `gemini-3.8-live`. It is a high-reasoning audio-to-audio Live API model with asynchronous function calling, background reasoning, and streaming audio. Google lists both as stable Live endpoints; default remains low-latency `gemini-3.8-live`.

Evidence (Google first-party, accessed 2026-09-26):
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking — stable code, Live API support, async function calling, background reasoning.
- https://ai.google.dev/gemini-api/docs/models — default vs extended thinking endpoint list.
- https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-live — shared Gemini 3.8 Live/Extended Thinking token prices (input text $0.75, audio $3, image/video $1; output text $4.50, audio $12 per million). Thinking tokens included in output price; absent modality breakdown must stay unknown rather than fabricating cost.

Production: Google picker offers both IDs, config persists optional prior Google choice across provider switches, transport uses selected ID with existing single direct main owner and nonblocking tools. No additional companion or separate text owner, no GPT modifications. Existing 3.x transcription finality inference applies to both Google models; explicit provider finality still wins. Default remains unchanged. Offline tests exercise picker persistence/reload, invalid model rejection, SDK setup shape, transcription inference and cost behavior.

Acceptance limits: offline fake transport is not a paid Google Live connection. No paid API, microphone/speaker device, latency or actual extended-thinking tool round trip tested; do not claim deployment/release validation. If provider behavior differs on real connection, investigate with opt-in paid/device tests before release.

Durable worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_1a7b19db-a86675007a5e-task_36c60681
Branch: die/gemini-supported-thinking-implementation-36c60681
