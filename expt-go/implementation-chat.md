# OpenAI Chat Completions compatibility lane

## Public constructor

The lane is constructed directly with:

    provider.NewChatCompletions(provider.Config) (core.Provider, error)

It deliberately is not selected by provider.New. The application/custom-provider factory is responsible for choosing it, so the existing OpenAI kind continues to use the Responses API (and Codex continues to use Codex Responses).

The constructor uses Config.Kind as the persisted provider identity, Config.Model as the fallback model, Config.APIKey for a Bearer authorization header, Config.BaseURL as the API root, and Config.HTTPClient for transport. An empty Kind becomes openai-completions, an empty BaseURL becomes https://api.openai.com/v1, and an API key is required. The request URL is BaseURL plus /chat/completions unless BaseURL already ends in that path.

## Request contract

Requests use the standard streaming Chat Completions shape:

- stream is true and stream_options.include_usage is true.
- System, user, assistant, and tool messages are projected to their standard Chat Completions roles.
- User images are image_url data URLs.
- Tool-result text remains a tool message. Tool-result images are projected in a following user image message, matching Pi's portable compatibility representation; image-only and empty results receive explicit placeholders.
- The built-in execute function schema is sent as a function tool.
- MaxTokens maps to max_completion_tokens and Thinking maps to reasoning_effort.
- Fast requests are rejected before network I/O. This compatibility path never requests a premium/service tier from custom endpoints.

A completed response stores a standard assistant message envelope (role, content, and tool_calls) in Message.Native. Native envelopes are replayed only when Message.Provider and Message.Model match the active identity (legacy unscoped native messages remain subject to the shared provider replay policy). Otherwise portable Content and ToolCalls are rebuilt. Unknown fields in a valid matching native envelope are retained.

## Streaming and completion rules

The parser consumes real data-framed SSE ChatCompletionChunk objects and emits native events plus text events. It requires both a non-null finish_reason for choice zero and the [DONE] sentinel. EOF before either is truncation and returns no executable response.

Tool fragments are correlated by their numeric tool-call index, with IDs used only to confirm or resume an existing correlation. Conflicting IDs/names, unindexed unknown fragments, sparse indices, invalid/incomplete JSON arguments, a tool finish without tools, or tool fragments with a non-tool finish are errors. No partial tool call is returned. If an otherwise complete call has no server ID, a deterministic call_ ID is derived from response ID, index, name, and final arguments, so replay and tool-result correlation remain stable.

finish_reason mappings are stop/end to stop, length to length, and tool_calls/function_call to tool. Content filtering, network errors, and unknown reasons fail explicitly.

Usage follows Pi/OpenAI accounting: prompt_tokens is split into uncached Input, prompt cache-read tokens, and cache-write tokens; completion_tokens is Output. Cache reads accept the documented prompt_tokens_details.cached_tokens and common DeepSeek/Kimi compatibility placements. Negative uncached input is clamped to zero. Static cost calculation is applied when Config.Kind and the model identify a known price.

Context cancellation is passed to the HTTP request and checked during stream parsing. Cancellation and every malformed/truncated stream return an error rather than a partial assistant/tool response.

## Intentional limitations

This is a narrow stateless compatibility lane, not an OpenAI SDK replacement. It has no retries, non-streaming mode, live API tests, premium/fast tiers, audio, logprobs, custom/grammar tools, legacy function_call request format, vendor routing controls, or provider-specific reasoning metadata synthesis. Only choice index zero is consumed. Endpoints must provide SSE Chat Completions chunks, a usable finish_reason, and [DONE]. The implementation adds no SDK or module dependency.
