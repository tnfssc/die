# models.json native configuration implementation

## Implemented schema

Godie reads `<state-dir>/models.json` first, then `<state-dir>/agent/models.json`, with this supported subset:

- Root: `providers` object.
- Provider: `baseUrl`, `api`, `apiKey` (literal), `headers` (literal string map), `models`, and `modelOverrides`.
- Model: `id`, `name`, `api`, `baseUrl`, `reasoning`, `thinkingLevelMap` (string or null values), `contextWindow`, `maxTokens`, and `headers`.
- Model override: `name`, `reasoning`, `thinkingLevelMap`, `contextWindow`, `maxTokens`, and `headers`.
- Native API values: `openai-responses`, `anthropic-messages`, and `google-generative-ai`. Existing `openai-completions` / `openai-chat-completions` remains supported.

Provider API/base URL values are defaults for model definitions. Model API/base URL values win over provider values. CLI `--base-url` and `--api-key` win over config values; an explicit CLI key also suppresses a conflicting configured header for that adapter’s authentication field. Provider headers are merged only into the selected provider instance; selected model headers are layered above provider headers. For model-definition headers, the definition is above the same ID's `modelOverrides` header, matching Pi's request-header composition.

Custom model definitions default to a 128,000 context window and 16,384 max output tokens. Their max token value is a provider request default; explicit `--max-tokens` wins. A false `reasoning` capability disables the implicit thinking default and rejects an explicit non-off thinking level. `thinkingLevelMap` remaps supported levels and rejects explicit null-mapped levels.

Built-in `openai`, `anthropic`, and `google` provider entries keep their built-in models, apply provider base URL/headers/key, upsert configured models by ID, and apply matching `modelOverrides`. `gemini` remains a CLI transport alias; a config entry is matched by its exact provider key.

OAuth Codex is intentionally not configurable through models.json. Entries for `codex` / `openai-codex` are refused, so config cannot change OAuth identity, inject credentials, reroute the endpoint, or obtain Fast service-tier authorization. Custom Responses adapters also fail the existing Fast authorization guard.

## Credential and provenance safety

Each constructed adapter owns a fresh header map. API-specific generated authentication is only created for that adapter: Bearer for Responses/Chat, `x-api-key` for Anthropic, and `x-goog-api-key` for Gemini. There is no shared mutable header state and no fallback from one configured backend to another. Native response and replay provenance uses the configured provider ID and selected model, rather than pretending custom endpoints are built-ins. HTTP error sanitization remains unchanged.

## Deliberately unsupported Pi schema/capabilities

This is not blanket models.json parity. Provider `name` is accepted but not surfaced. Godie currently ignores Pi fields `oauth`, `authHeader`, `compat`, `input`, `cost`, `samplingParams`, and cost tiers. It does not execute `!command` values or interpolate `$ENV_VAR` in config keys/headers; those values are literals. It does not support Azure Responses, Google Vertex, Bedrock, or arbitrary new adapter registration. Nested compatibility knobs, dynamic model refresh, extension provider composition, custom auth persistence, and per-model sampling-body injection are also unsupported.

`ModelsForState` exposes merged configured context windows to integration owners. The current autocompaction/status call sites still use the embedded `Models()` catalog and must switch to `ModelsForState(stateDir)` to consume custom context-window overrides; those files are outside this ownership slice.

## Offline evidence

- `validation/config-native-cli.py`: actual CLI loopback runs for all three native APIs, checking paths, model/default token fields, custom headers, and absence of other adapters' generated credential headers.
- `internal/app/provider_test.go`: native route, default, override, provenance, and header-scope fixtures.
- `internal/app/config_capabilities_test.go`: built-in merge, model override, thinking map, model-level transport, and Codex refusal.
