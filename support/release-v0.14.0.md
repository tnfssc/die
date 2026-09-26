# v0.14.0

- Restore `gpt-live-1` in CLI Live. GPT-Live handles voice and delegates reasoning and tools to your selected coding-agent session. No separate OpenAI reasoning model is required.
- Add `gemini-3.8-live-extended-thinking`, with its required thinking setup and background interaction status. Ordinary Gemini remains the default.
- Show task attention notices in normal terminal color. Real warnings and failures keep their colors.

Choose a voice model with `/live model`. GPT-Live needs an OpenAI API key; Codex OAuth alone cannot authenticate its voice connection. Gemini needs a Google API key. Your coding-agent credentials remain separate.

Voice interruption, stopping Live, and cancelling work remain separate. Stopping Live preserves running jobs. GPT-Live speech transcripts are provisional context, not verified final speech.

Offline provider-wire and real coding-session/tool tests cover the integrations. Connected paid-provider and microphone/speaker acceptance was not run: canonical Live API keys were missing on the build host. Real provider availability, speech quality, and end-to-end latency remain unverified.
