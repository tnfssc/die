# Provider-native fast mode

Die's initial native fast mode is an explicit, session-local provider request setting. It is separate from `/mode fast` and sub-agent profile `fast`: it does not change the model, thinking level, instructions, or delegation behavior.

## Commands and consent

- `/fast` and `/fast status` only report status; a bare command never enables billing.
- `/fast on` requires the TUI premium-cost confirmation. Noninteractive launches must include `--accept-cost`.
- `/fast off` records an explicit model-bound opt-out and sends `service_tier: "default"`. Sessions/models that the user has not touched are not overridden.

The setting is stored on the active session branch with its exact session, provider, and model identity. A new session starts off. A model switch activates only an authorized record already on that branch for the switched-to exact model. Parent records do not authorize child/sub-agent sessions.

## Supported surfaces and wire values

The allowlist is exact rather than prefix-based:

- OpenAI API, official `openai` Responses endpoint/auth surface: `gpt-6-astra`, `gpt-5.6-sol`, and `gpt-5.3-codex`. The request uses `service_tier: "fast"`.
- Codex with ChatGPT sign-in, official `openai-codex` endpoint/auth surface: `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, and `gpt-5.4`. The official Codex source maps Fast to the legacy-equivalent wire value `service_tier: "priority"`.

The official Codex model snapshot explicitly advertises the priority tier for each listed alias, including Luna; support is not inferred from the `gpt-5.6` prefix. `gpt-5.3-codex-spark` and `gpt-5.4-mini` are intentionally excluded. Spark is a separate model, not native fast mode. Custom gateways, alternate endpoints, Anthropic, and other providers are rejected before dispatch.

Anthropic support is deferred. Its native API mechanism is `speed: "fast"` plus the `fast-mode-2026-02-01` beta header, not an effort change. Supporting its direct/subscription auth and availability semantics safely requires a separate adapter.

## Runtime compatibility and status evidence

Pi 0.85's low-level OpenAI Responses and Codex SSE/WebSocket serializers support `serviceTier`, but `streamSimple` reconstructs base options and drops it. Die therefore inserts `service_tier` in the existing `before_provider_request` payload pipeline, before its capture and observation hooks. This preserves registry auth, headers/hooks, context filtering, model sampling/reasoning settings, tools, and the existing SSE/WebSocket transports. Offline integration fixtures assert the final serialized SSE bodies and WebSocket frame.

The footer bolt is provider status, not a working spinner:

- ` fast requested (unconfirmed)`: the final request payload asked for fast mode.
- ` fast confirmed`: reserved for an actual response-tier value when the runtime exposes one.
- ` standard (fast downgraded)`: reserved for actual `service_tier: "default"` response evidence.
- ` fast requested (tier unknown)`: a response arrived without tier evidence.
- ` fast off`: the user explicitly selected default/standard for this model.

Pi 0.85 does not expose the Responses body `service_tier` to extensions after serialization. Current real requests therefore remain requested/unconfirmed or tier-unknown; die does not claim confirmation from latency or estimated cost. It does not fail a successful tool-using turn because tier confirmation is unavailable, and it performs no automatic standard retry, upgrade, or model swap.

## Cost and compaction policy

Codex documentation currently describes model-dependent ChatGPT credit multipliers (2x or 2.5x), while API Priority/Fast uses separate token pricing (for example, the documented GPT-5.6 API rate differs from ChatGPT credits). Die does not estimate or claim credit counts. Footer dollar values are client-side SDK estimates, not provider billing; the provider dashboard is authoritative.

Both plaintext and native Codex compaction explicitly send `service_tier: "default"`, even if an ordinary captured request was fast. There is no hidden premium fast compaction. No tier from a captured ordinary request leaks into compaction.

## Source evidence

Implementation was checked against the supplied OpenAI API Fast mode page, Codex speed page, and the official OpenAI Codex source/model snapshot. The OpenAI API documents `fast` and `priority` as equivalent for supported models and reports `default` on a downgrade. The official Codex client normalizes legacy `fast` to the `priority` request value and its model metadata provides exact service-tier aliases.
