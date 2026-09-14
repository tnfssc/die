# Provider implementation

## Public API (reported early)

Package `godie/internal/provider` owns transport and credential isolation.

`New(Config) (core.Provider, error)` creates one provider adapter. `Config` selects `Kind` (`openai`, `codex`, `anthropic`, or `gemini`), optional default `Model`, explicit `APIKey`, `BaseURL`, `HTTPClient`, and (Codex only) `AuthStateDir` plus an `OAuthBaseURL` fixture/private-authority override. Environment lookup is opt-in through `UseEnvironment`; it never reads auth files.

`ImportCodexAuth(sourceFile, stateDir string) error` is the only auth import lane. It reads the caller-selected Pi/die auth JSON and copies only the `openai-codex` OAuth record into `stateDir/auth.json` (0600, atomic). Source files are never modified. `New` loads and refreshes only this isolated copy. No path defaults to `~/.die` or `~/.pi`.

Codex auth supports explicit import and a bounded manual browser-PKCE helper. `BeginCodexBrowserLogin` only constructs the Pi-compatible authorization URL (it never opens a browser, binds a listener, or performs I/O); caller-owned `Complete` validates the exact localhost callback/state, exchanges under the caller context, and atomically writes isolated state. Refresh uses the OAuth refresh grant and atomically updates isolated state.

## Wire behavior

All adapters use `net/http` and streaming JSON/SSE. This avoids adding dependencies/go.mod contention and, more importantly, retains native response items/events needed for replay. `core.Message.Native` contains provider-native response content and is replayed without normalization. Tool call IDs are retained end-to-end. Context cancellation owns the HTTP request and response body.

## Current coverage and gaps

Local `httptest` fixtures cover OpenAI native item replay, streamed text, exact tool IDs/arguments, cache usage, cancellation, Codex import/refresh/header construction and source immutability, Anthropic native replay/tool blocks/cache usage, Gemini thought-signature replay/tool calls/usage, API-key header placement, and explicit fast-tier refusal. `go test ./internal/provider` and `go vet ./internal/provider` pass. (A whole-tree run initially passed; later concurrent runs were blocked by in-progress integration-owned app/session edits.) No live/premium calls were performed.

Intentional gaps: no automatic browser launch/local callback server or device-code polling, no Codex WebSocket optimization (SSE preserves semantics with less state), no dynamic model discovery, and no Anthropic/Gemini thinking controls. Unsupported fast or provider-specific thinking controls fail rather than silently degrading. OpenAI Responses reasoning effort is passed through. HTTP non-2xx bodies are discarded so credentials returned by an upstream can never enter errors.


## Compaction, pricing, and registry research

Read the original implementations in `src/tasks/native-compaction.ts`, `cache-affine-compaction.ts`, and `native-fast-mode.ts` before implementation. Also inspected the installed source registry `@earendil-works/pi-ai` 0.85.0 (`dist/providers/data/openai-codex.json`) and its exact Codex OAuth implementation. The current Codex registry contains `gpt-5.4` as a standard model (272k context, static $2.50/$15.00/$0.25 per million input/output/cache-read below its documented tier threshold). Recommendation: keep app default `gpt-5.4`; unlike `gpt-5.3-codex-spark`, it is not the fast-only alias.

Package API added: optional `provider.Compactor` with `Compact(context.Context, core.Request, func(core.StreamEvent)) (core.Response, error)`. Codex implements native remote-v2 compaction by appending only `compaction_trigger`, forcing `service_tier: default`, retaining the single opaque item, validating terminal status/item agreement/accounting, and never falling back. Other adapters implement portable cache-affine summary compaction by preserving the request prefix and appending one summary instruction. Checkpoint replay requires the exact original provider/model; unscoped legacy ordinary native messages remain compatible, but unscoped opaque compaction items are rejected.

`Pricing(provider, model)` exposes only exact static registry entries included in `pricing.go`; response costs are calculated only on exact matches. Unknown models retain zero cost rather than guessed billing. Current app-default static entries are included, along with all current Codex registry entries.

Coordinator work still needed: project the optional `provider.Compactor` into slash-command/app behavior, persist/display the returned compaction message and usage, and present/collect the manual browser login URL/callback if desired. No `core` API change is required. No live or premium request was made.

Validation: `go test ./internal/provider`, `go vet ./internal/provider`, and `go test -race ./internal/provider` pass, including native compaction shape/tier/opaque replay, pricing, and local-only PKCE exchange fixtures. A final `go test ./...` also passes.


## Guarded native fast transport parity

The provider API is unchanged. `core.Request.Fast` is consumed as app-authorized, immutable request intent: each OpenAI adapter snapshots the resolved provider/model/Fast identity at `Complete` entry, applies the selected tier only to that request's finished Responses payload, and validates the exact payload model and tier immediately before serialization/dispatch. There is no generic `service_tier=priority` path, model remap, retry, or standard-tier downgrade.

Fast transport is fail-closed to the original exact lanes: official OpenAI Responses (`https://api.openai.com/v1`) uses `service_tier: fast` only for `gpt-6-astra`, `gpt-5.6-sol`, and `gpt-5.3-codex`; official Codex (`https://chatgpt.com/backend-api`) uses `service_tier: priority` only for `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, and `gpt-5.4`. Custom endpoints, family/prefix aliases, Anthropic `speed=fast`, and all other providers are refused before transport.

Portable OpenAI Responses compaction now carries explicit `service_tier: default` in a private request-local context scope; Codex native compaction retains its existing explicit default tier. Ordinary non-fast requests remain unchanged (no tier field). The Codex SSE reducer and native `response.output_item.done` accumulation were not changed. Provider errors still return through the existing app coordinator, so its append-only failed `provider_attempt` accounting is unchanged.

Coverage is fixture-only: an intercepting local `RoundTripper` verifies exact serialized API/Codex tier fields and official URLs; refusal tests verify custom endpoints, unsupported lookalike aliases, and Anthropic fast never dispatch; compaction verifies `default`; and a transport failure verifies exactly one fast attempt with no retry/downgrade. No live or premium request was made.


## models.json adapter, Anthropic defaults, and provenance loopback (final integration)

Godie now loads an immutable custom-provider snapshot from either `<state-dir>/models.json` or `<state-dir>/agent/models.json` (root takes precedence). The accepted adapter is deliberately narrow: a selected provider must name an exact configured model and use `openai-completions` (or its explicit `openai-chat-completions` alias). The app then constructs the existing Chat Completions adapter with the configured provider identity, base URL, key, and model; CLI key/base URL overrides remain explicit. Unknown APIs and unlisted models fail before dispatch. Initial application setup and the interactive `/model` switch share this resolution path. Config loading does not execute commands or consult credentials in the environment.

The CLI no longer turns its implicit output-token default into an explicit provider limit. `core.Request.MaxTokens == 0` now lets each adapter choose its own default, while `--max-tokens` remains exact. This fixes ordinary Anthropic `medium` reasoning on non-adaptive models: the provider can reserve the 8192-token thinking budget and raise its implicit output ceiling to 9216, rather than rejecting every default request because an app-injected 8192 ceiling looked user-specified. Explicit undersized Anthropic limits remain fail-closed.

Fixture-only coverage includes an actual custom models.json Chat Completions request against loopback, exact custom response provenance, default model selection, invalid model/API refusal, and option default/override behavior. A second transport test performs an OpenAI Responses completion on one loopback server and feeds that native-bearing message into Anthropic on another. It verifies that OpenAI opaque item identity is not serialized across providers, portable assistant text is retained, Anthropic medium thinking is serialized with its valid implicit budget, and the returned message is tagged with Anthropic/model provenance.

Validation: `go test ./...` and `go vet ./internal/provider ./internal/app` pass. `go test -race ./internal/provider ./internal/app` passes. No live or paid provider request was made.

## Coordinator final corrections
Explicit Anthropic off is accepted as disabled thinking (main native probe had switched to off). Custom reasoning:false defaults omit reasoning_effort, while explicit unsupported non-off levels fail. Chat Config.DefaultMaxTokens applies configured defaults request-locally rather than mutating Options.MaxTokens into a false explicit cap. Model switches and restored branch policy use the shared resolver. Real persistent native-SSE CLI evidence in evidence/final-native passes OpenAI → Anthropic → OpenAI with native archive state retained and foreign opaque state excluded outbound.
