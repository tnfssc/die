# Cache retention estimate

The footer’s `cache est` value is an informational local clock, not a provider guarantee and not evidence of an actual cache hit. Its nominal TTL defaults to one hour. Use `/cache-ttl 30m`, `/cache-ttl 1h`, or another duration from one minute through seven days; the value persists in `~/.die/settings.json`. Running `/cache-ttl` with no argument reports the current value.

## Timestamp semantics

A call is timestamped when Pi emits `before_provider_headers`: request headers have been assembled and HTTP dispatch is immediately next. This pipeline seam is intentionally used instead of assistant text or turn events. Every request attempt resets the estimate, including automatic retries, requests that later return an error, and LLM-backed compaction. A failure before this seam does not reset it. Response completion does not reset it a second time; measuring from dispatch is conservative and works for interrupted streams.

Records contain the exact provider/model and are durable session custom entries. Resume and compaction retain them. Switching provider or model shows unknown until that exact pair has a recorded call (switching back may reuse its earlier estimate). Each agent owns a different session/runtime, so descendant calls never reset the parent footer. Tool execution, assistant rendering, completion notices, and redraws do not reset it.

The display updates at visible minute boundaries, becomes warning-colored at 15 minutes, error-colored at 5 minutes, and says `expired` rather than counting negative time. Before a matching call it says `cache est ?`.
