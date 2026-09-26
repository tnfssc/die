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

Integration review added the missing thinking-session setup and UI lifecycle:
- https://ai.google.dev/gemini-api/docs/live-api/thinking requires nonblocking
  tools and distinguishes background reasoning from audio turn completion.
- https://ai.google.dev/gemini-api/docs/live-api/capabilities lists low/medium/high
  for Extended Thinking; minimal is unsupported and ordinary 3.8 must omit it.
- Extended Thinking now sends SDK ThinkingLevel.LOW explicitly, matching Google's
  example; no reasoning-level picker is added. Ordinary 3.8 sends no thinkingConfig.
- SDK 2.24.0 exposes interactionStatus on LiveServerContent (not the top-level
  message used in some guide snippets). IN_PROGRESS retains thinking presentation
  across filler turnComplete; only IDLE clears it. Audio turn bookkeeping/cost and
  transcript boundaries remain per provider turn, not conflated with session idle.
- Both exact Gemini models exercise the real main-owner execute/shell/completion
  route with fake provider transport and zero text-model streams.

Parent integration path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_1a7b19db
Branch: die/restore-gpt-live-and-add-gemini-live-thi-1a7b19db.
The first worker (task_643e2f05) was stopped after a tool syntax error and stalled
model response; no code from it was integrated. Replacement task_36c60681 supplied
ad14518 (integrated as aa6b1e7), then parent added the lifecycle fixes above.
Values unchanged: honest state, one owner and protocol evidence already apply.

Final integrated gate: bun run check passed; matching private CLI build using
--reuse-web passed; SHELL=/bin/sh bun test ./tests: 1109 pass, 17 skip, 0 fail,
27452 assertions / 1126 tests / 149 files (103.69s). Focused config/extension/
session/cost suite: 79 pass, 0 fail. git diff --check passed. The 17 opt-in skips
are not paid/device/LLM acceptance. No publish, release or install was performed.

## Independent review and authorized provider-probe gate (2026-09-26)

The user explicitly authorized bounded paid Live probes, including ordinary Gemini and Extended Thinking direct function-result continuation, without a microphone. Google primary documentation (HTTP 200 at model/pricing URLs above and https://ai.google.dev/gemini-api/docs/live-api/thinking) independently confirms exact model ID `gemini-3.8-live-extended-thinking`, AUDIO response, supported LOW/MEDIUM/HIGH thinking levels (not MINIMAL), required NON_BLOCKING function declarations, filler audio before tool completion, and interactionStatus IN_PROGRESS/IDLE across multiple audio turnComplete events. Google's protocol example sends functionResponses with call id and returns final audio plus IDLE; SDK 2.24.0 types place interactionStatus on LiveServerContent. Ordinary 3.8 omits thinkingConfig. Pricing lists both 3.8 Live models together: per million paid input text $0.75/audio $3/image-video $1; output text $4.50/audio $12 including thinking. Missing usage modalities remain unpriced.

Attempted normal application resolver createDefaultLiveCredentialService().status() after frozen-lockfile dependency install: {"state":"missing","canImport":true}. Thus loadKey() was not called, no key was printed, and **zero paid Live requests** were made. The resolver does not inspect legacy live.env during status/loadKey; importing requires separate user action. No alternate secret locations were searched. Ordinary and Extended Thinking real transport, audio/test input, function call/result continuation, actual usage and latency remain unverified; synthetic transport tests cannot substitute for paid probes. This is an access limit, not a failed provider response. Authorized probes should be run when a canonical Google API key is configured.

Reviewed aa6b1e7 and 13d6aac against source and primary protocol: selection/persistence, exact endpoint routing, nonblocking tool declarations, thinkingConfig only for extended, SDK serverContent status handling, tool response continuation, per-turn cost and transcription. One concrete interoperability issue: the model page states function scheduling configurations are unsupported, but the shared sendToolReply always sent scheduling: WHEN_IDLE. Extended Thinking now omits scheduling on its function responses while ordinary Gemini retains its existing behavior. Fake-wire regression asserts an identified direct tool call returns a result without scheduling. GPT blocker is outside this review.

Review validation: bun run check and git diff --check pass. Focused session/tools/config/cost/extension: 88 pass, 0 fail; source-only main-owner integration with a complete PATH and SHELL=/bin/sh: 15 pass, 0 fail, including both models' direct execute/shell/background-completion fake provider wire. An initial incomplete PATH caused integration fixture failures (dirname missing); corrected rerun passed. Local full build was attempted but stopped in unrelated T3 web preparation because pnpm was not on PATH; no release build or provider/device acceptance claim follows from these tests.
