# CLI live voice cost (2026-09-25)

Branch die/add-cli-live-voice-to-session-cost-ba653160; worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ba653160.

Provider usage events (not audio frames or footer timers) append die-live-cost increments to Pi session JSONL. The footer reads them alongside but never as coding-agent usage. Session resume retains increments. The ordinary descendant-cost reader still sums coding-agent messages only. The footer marks active voice ~ and incomplete billing +?, never a complete zero.

Public sources checked 2026-09-25 (no credentials or paid calls):
- https://ai.google.dev/gemini-api/docs/pricing : Gemini 3.8 Live standard paid input $0.75/M text, $3/M audio, $1/M image/video; output $4.50/M text, $12/M audio. Free tier, discounts, grounding charges cannot be inferred. Requires promptTokensDetails and candidatesTokensDetails modality counts; absent modality or nonzero thinking tokens without modality are unknown.
- https://developers.openai.com/api/docs/pricing : gpt-realtime-2.1 input/output audio $32/$64 per M tokens and text $4/$24; mini audio $10/$20 and text $0.60/$2.40. Realtime response.done.response.usage input/output token details report audio counts. Cached tokens require separate modality split; unknown rather than full-price fiction. Configured separate input transcription (gpt-4o-mini-transcribe) may bill independently and is not covered by response usage: total remains incomplete.
- https://developers.openai.com/api/docs/pricing and https://developers.openai.com/api/docs/guides/live-conversations#usage-and-graceful-close : GPT-Live-1 voice duration $0.05/min, billed by second. session.usage.updated.usage.seconds is cumulative, final session.closed.usage.seconds reconciles. Backend model/tool usage billed separately and is not reported here; total incomplete even after graceful close. Never substitute Realtime token prices for GPT-Live duration.

GPT-Live cumulative usage, Realtime per-response IDs, Gemini per-turn cumulative metadata (reset at turnComplete) are kept distinct. No wall-clock/audio-byte estimate: provider reporting may lag, be absent or be partial. Lost final event retains latest seen duration and marks unknown. Gemini lost last usage event cannot be measured offline. Unknown entries are durable. No web relay/controller or t3 integration changed.

Proof: offline transport/pricing/footer regression and bun run check; no physical audio or paid provider call. Existing shared values cover truthful unknown-cost disclosure, event ownership and preserving historical usage; values.md unchanged.
