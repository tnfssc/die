OpenAI voice is now available alongside the unchanged Google Gemini default. Choose exactly `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, or `gpt-live-1`; provider/model selection is persisted independently of the coding-agent model. GPT-Live uses its own continuous WebSocket transport, not the Realtime protocol.

Update with `die update`, then restart die. Inside die:

1. Run `/login` → `Sign in with an API key` → OpenAI to save the canonical OpenAI API key. Never paste keys into chat.
2. Run `/live provider openai`, then `/live model gpt-realtime-2.1` (or `gpt-realtime-2.1-mini` / `gpt-live-1`).
3. Run `/live setup` and follow the setup/start prompts. Use `/live status` to check selection, `/live start` to start explicitly, and `/live stop` to stop voice without cancelling agent jobs.

This uses separately billed OpenAI API access, not a ChatGPT subscription or Codex OAuth. Starting voice may incur API charges. Native Live audio requires macOS arm64; Linux and Android CLI releases remain available. The Mac executable includes its native helper and the normal updater remains supported.

GPT-Live local interruption/automatic recovery uses a PCM RMS heuristic, not a trained speech detector or server cancellation acknowledgment. After qualified quiet, output resumes on the same connection; stale output tails remain possible. Received transcripts are not proof that all audio was played. Offline protocol and device-free release checks do not establish paid API/model entitlement, real microphone/speaker behavior, acoustic quality, or double-talk performance; no paid API or physical-device validation was performed for this release.
