# Cache retention estimate

The footer’s `cache est` value is an informational local clock, not a provider guarantee and not evidence of cache creation or a cache hit. Its nominal TTL defaults to one hour. Use `/cache-ttl 30m`, `/cache-ttl 1h`, or another duration from one minute through seven days; the value persists in the dedicated `~/.die/cache-settings.json`. Running `/cache-ttl` with no argument reports the current value.

The cache settings writer uses an atomic replacement and never reads, rewrites, or deletes `~/.die/settings.json`. Invalid JSON or invalid cache settings produce a visible startup warning, leave the corrupt file untouched, and fall back to the default estimate until a valid value is saved.

## Timestamp semantics

Ordinary and plaintext-compaction requests are timestamped only after their fetch has returned an HTTP response. When a runtime supplies `event.model`, that request-local identity is authoritative. Pi 0.85 omits it, so die captures provider/model synchronously at `before_provider_request` and never reads `ctx.model` after an await. Each response-backed retry is a separate observation. Payload-hook rejection, budget cancellation, serialization failure, abort before a response, and transport failure without a response do not reset the estimate.

Native Codex compaction uses a direct fetch that bypasses Pi’s provider response hooks. It is timestamped at the exact direct-fetch dispatch, after payload/header serialization and a final abort check. Thus a dispatched native transport failure does reset the estimate, while rejection or abort before dispatch does not. This distinction is deliberately conservative and reflects the narrow seams available; the timestamp is neither request completion time nor proof that a provider accepted or cached content.

Records contain the exact dispatched provider/model and are durable session custom entries. Resume and compaction retain them. Switching provider or model shows unknown until that exact pair has a recorded call (switching back may reuse its earlier estimate). Each agent owns a different in-memory session manager, so descendant calls never reset the parent footer. Tool execution, assistant rendering, completion notices, redraws, and merely entering native-compaction preparation do not reset it.

The footer schedules redraws only at visible minute boundaries; it does not require a one-second countdown timer. The display becomes warning-colored at 15 minutes, error-colored at 5 minutes, and says `expired` rather than counting negative time. Before a matching observed call it says `cache est ?`.
