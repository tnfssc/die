# Realtime setup PCM rate fix

- The shared OpenAI Realtime session config now explicitly sends output PCM rate 24000. An authorized production-transport setup with gpt-realtime-2.1-mini rejected the omitted rate with missing_required_parameter / invalid_request_error at session.audio.output.format.rate; one same-model followup accepted session.updated after this fix.
- This proves mini setup acceptance only. Neither audio nor full-model acceptance was tested. Both Realtime models use the same corrected config. No further provider, key or device calls were made for this release.
- Safe allowlisted provider code/type/field diagnostics and strict offline setup-contract mutation tests accompany the fix. The setup-only probe is disabled by default before auth-file reads and requires explicit opt-in; it is not run by release gates.
- Existing voice controls and transcript behavior are preserved.

## Update and retry

Run `die update`, restart die, then confirm `die --version` reports 0.11.1. Use `/live provider openai`, `/live model gpt-realtime-2.1-mini`, `/live status`, then `/live start`. The full model `gpt-realtime-2.1` uses the same fix but was not live-tested. Keep the saved key private and unchanged. Voice retries may incur normal API charges; share only sanitized errors, not keys or raw logs.
