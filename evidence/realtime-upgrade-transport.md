# Realtime Upgrade transport (offline proof)

Bun 1.4.2 native WebSocket sends Authorization but exposes only "Expected 101 status code" on rejected Upgrade, not the HTTP status. URL/auth were already corrected in 51b009b. Only OpenAI Realtime default socket is replaced with pinned ws 8.21.3 (updated during release review; see [registry/security evidence](realtime-ws-registry-security.json)), exposing unexpected-response on the original authenticated Upgrade. No REST probe, retry, fallback model, key lookup, or change to Gemini/GPT Live/Mac.

Response is capped at 4096 bytes and 1 second, then destroyed. Only numeric HTTP status and existing allowlisted codes (invalid_api_key, model_not_found, insufficient_quota, rate_limit_exceeded) are classified. No raw body, headers, exception text, URL, or key enters diagnostics. No HTTP response still means status unavailable. Session errors retain existing allowlist.

Offline checks (fake key, loopback only):
- `mise exec -- bun test tests/openai-session.test.ts`: 32 pass; 401/403/404/429/503, codes, malformed/oversized responses and session rejection.
- `mise exec -- bun build --compile scripts/live-openai-offline-smoke.ts --outfile /tmp/die-openai-smoke && /tmp/die-openai-smoke`: compiled success/audio/header and 401/403/404/429 failures.
- `mise exec -- bun run build` and `mise exec -- bun run check`: compiled full CLI at `dist/die`; TypeScript passed.
- `mise exec -- bun run generate:notices`: 126 production packages; ws license in generated release notice.

No real OpenAI call made. User next test determines actual provider rejection, if any; local success does not prove remote model access.

Release review reran 33 focused tests and compiled provider smoke with pinned ws 8.21.3, plus format/lint/diff checks. Added stalled partial-response regression: exactly one request and sanitized failure, bounded completion, closed peer. Bun 1.4.2 ends this partial rejected-Upgrade response early, so the test proves cleanup but does not exercise the full one-second timer; the explicit fallback timer is source-audited. The original ws 8.18.3 pin was rejected: official npm advisories GHSA-58qx-3vcg-4xpx and GHSA-96hv-2xvq-fx4p affect it. The official registry current stable 8.21.3 has no ws advisory in the same query. Gemini already resolved ws 8.21.3 transitively; lockfile deduplication does not change its resolved version.

Feature handoff and release tracking: [wisdom/live/openai-realtime-upgrade-transport.md](../wisdom/live/openai-realtime-upgrade-transport.md).
