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

Pi 0.85's low-level OpenAI Responses and Codex SSE/WebSocket serializers support `serviceTier`, but the agent path reconstructs simple options. Die therefore uses a narrow compatibility seam pinned to Pi 0.85: the active `ModelRuntime` instance's private `prepareRequest`/`streamSimple` sequence and the registry's `runtime` reference. Enabling fast, or restoring an enabled record at session start, reports an error instead of becoming a no-op if that seam is absent. The patch is scoped to the bound runtime instance and is removed at session shutdown; it does not patch `ModelRuntime.prototype` globally.

Request selection is synchronous and request-local. At the concrete `streamSimple` call, die snapshots the session/branch authorization, provider/model IDs, requested tier, and OAuth-versus-non-OAuth gate. That boolean gate distinguishes the supported billing/auth surfaces; it is not a claim that die identified a particular account. After asynchronous auth preparation, die checks the prepared provider/model IDs, endpoint support, and auth gate. It writes the snapshot tier into the initially serialized payload before the extension payload-hook pipeline, then validates the final model and tier after every hook and before provider dispatch. A request with no authorization snapshot remains completely untouched even if the user enables fast or changes model/session while preparation is awaiting. Conversely, on/off or model changes affect the next request, not one already captured. Hook exceptions are not a safety boundary.

Only agent requests routed through the bound `ModelRuntime` have this guarantee. Calling a low-level provider module's `streamSimple` API directly bypasses die and is not a supported native-fast integration. Registry auth, headers/hooks, context filtering, sampling/reasoning settings, tools, and SSE/WebSocket transport are otherwise unchanged.

The footer bolt is provider status, not a working spinner:

- ` fast requested (tier/cost estimate unavailable)`: the guarded final request asked for fast mode; it is not confirmation of the provider's actual response tier.
- ` fast off`: the user explicitly selected default/standard for this model.

Pi 0.85 does not expose the Responses body `service_tier` to extensions after serialization. Die therefore never claims a confirmed or downgraded tier, and never attributes response evidence from a different request. It performs no automatic standard retry, upgrade, or model swap.

## Cost and compaction policy

Codex documentation describes model-dependent ChatGPT credit multipliers, while API Fast uses separate token pricing. Die does not invent or display credit estimates. Pi 0.85 prices `priority` responses but does not recognize the newer API `fast` response value, so die explicitly marks the session footer cost estimate unavailable once fast has been authorized (including after later opt-out) rather than presenting a dollar/credit estimate as authoritative. Provider billing is authoritative.

Both plaintext and native Codex compaction explicitly send `service_tier: "default"`, even if an ordinary captured request was fast. There is no hidden premium fast compaction. No tier from a captured ordinary request leaks into compaction.

## Source evidence

Pinned sources used for this allowlist and wire mapping:

- OpenAI API Fast mode: https://developers.openai.com/api/docs/guides/fast-mode
- OpenAI Codex commit `ad931a45b201e3877d6ba542ba5dbbd85e7e31b4`, model catalog (including the explicit Luna and Terra `priority` service tiers): https://github.com/openai/codex/blob/ad931a45b201e3877d6ba542ba5dbbd85e7e31b4/codex-rs/models-manager/models.json
- The same pinned Codex commit's request mapping (`Fast => "priority"`, while both `fast` and `priority` parse as Fast): https://github.com/openai/codex/blob/ad931a45b201e3877d6ba542ba5dbbd85e7e31b4/codex-rs/protocol/src/config_types.rs#L527-L550
- Pinned model capability check: https://github.com/openai/codex/blob/ad931a45b201e3877d6ba542ba5dbbd85e7e31b4/codex-rs/protocol/src/openai_models.rs#L905-L914
