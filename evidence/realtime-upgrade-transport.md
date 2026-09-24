# Realtime Upgrade transport (offline proof)

Bun 1.4.2 native WebSocket sends Authorization but exposes only "Expected 101 status code" on rejected Upgrade, not the HTTP status. URL/auth were already corrected in 51b009b. Only OpenAI Realtime default socket is replaced with pinned ws 8.18.3, exposing unexpected-response on the original authenticated Upgrade. No REST probe, retry, fallback model, key lookup, or change to Gemini/GPT Live/Mac.

Response is capped at 4096 bytes and 1 second, then destroyed. Only numeric HTTP status and existing allowlisted codes (invalid_api_key, model_not_found, insufficient_quota, rate_limit_exceeded) are classified. No raw body, headers, exception text, URL, or key enters diagnostics. No HTTP response still means status unavailable. Session errors retain existing allowlist.

Offline checks (fake key, loopback only):
- `mise exec -- bun test tests/openai-session.test.ts`: 32 pass; 401/403/404/429/503, codes, malformed/oversized responses and session rejection.
- `mise exec -- bun build --compile scripts/live-openai-offline-smoke.ts --outfile /tmp/die-openai-smoke && /tmp/die-openai-smoke`: compiled success/audio/header and 401/403/404/429 failures.
- `mise exec -- bun run generate:notices`: 126 production packages; ws license in generated release notice.

No real OpenAI call made. User next test determines actual provider rejection, if any; local success does not prove remote model access.
