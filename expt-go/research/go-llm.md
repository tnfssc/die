# Go LLM/provider/agent stack for die

Research date: 2026-09-13. “Verified” below means supported by the linked vendor/project documentation or observed in the current repository; it does **not** mean we ran provider integration tests. Product choices and unverified compatibility assumptions are labeled separately.

## Recommendation

Build die's agent runtime itself and put a small, strict adapter around each vendor's **official Go SDK**:

- OpenAI: [`openai/openai-go`](https://github.com/openai/openai-go), using the Responses API.
- Anthropic: [`anthropics/anthropic-sdk-go`](https://github.com/anthropics/anthropic-sdk-go), using Messages (and the beta surface only where an explicitly supported feature requires it).
- Google: [`googleapis/go-genai`](https://github.com/googleapis/go-genai), not the deprecated generative-ai-go package.

Do not make Eino or Google ADK the core runtime. They solve graph/agent/session problems die already has opinions about, while the difficult part of this rebuild is lossless provider behavior: opaque reasoning/compaction blocks, exact tool-call correlation, cache controls, usage, cancellation, and resumable child processes. A framework abstraction does not remove that work and can hide the wire details needed to do it correctly.

Keep agents as supervised child **processes**, as die does today, rather than turning all agents into goroutines in one process. Use goroutines inside one agent for streaming, independent tool calls, persistence, and UI delivery. Add explicit global/per-provider admission limits instead of today's effectively unbounded batch spawn.

## What the replacement must preserve from die

The current code is not merely a chatbot wrapper:

- `src/cli.ts` initializes Pi's OAuth implementations and then delegates the CLI/TUI/provider loop to `pi-coding-agent`. `runtime-assets/package.json` redirects Pi state into `~/.die`.
- Pi sessions are append-only JSONL trees (entry `id`/`parentId`), with messages, model/thinking changes, compactions, branch summaries, and custom entries. die creates and persists a child session header *before* launch, then records parent/task metadata (`src/tasks/agent-session.ts`).
- `src/tasks/job-service.ts` launches each subagent as another die process with its own session file. Batch prompts launch concurrently; normal/fast leaves cannot delegate, while orchestrators may delegate to depth two. Jobs survive a short foreground wait, expose bounded output paging/stdin/stop, and later notify their owning session.
- `src/tasks/cache-affine-compaction.ts` captures the actual outgoing request and attempts plaintext compaction without changing its cache-bearing prefix. It conservatively cancels rather than issuing a second inference after an ambiguous failure.
- `src/tasks/native-compaction.ts` has a special `openai-codex-responses` path. It copies a captured Codex request, forces standard service tier, appends `compaction_trigger`, parses the SSE result, and persists an opaque `{type:"compaction", id, encrypted_content}` plus usage. Reconstruction is valid only for the matching API/provider/model.
- Provider-attempt observations, cost roots, cache clocks, cancellation ownership, notification delivery, and output truncation are product behavior, not incidental framework plumbing.

A Go rebuild therefore needs provider projections over a durable session/event model, not a single `[]Message` shared by every API.

## Direct official SDKs

### OpenAI Responses

**Verified support**

- The official Go README shows `client.Responses.NewStreaming`, typed streaming events, Responses function tools, function-call outputs correlated by `CallID`, and continuation with `PreviousResponseID` ([SDK README](https://github.com/openai/openai-go#streaming-responses), [Responses API](https://developers.openai.com/api/reference/resources/responses)).
- Responses can be managed by resending input, chaining with `previous_response_id`, or using durable Conversation objects ([conversation state](https://platform.openai.com/docs/guides/conversation-state?api-mode=responses)).
- The documented API now supports automatic compaction via `context_management`/`compact_threshold` and standalone `POST /responses/compact` ([compaction guide](https://platform.openai.com/docs/guides/compaction)). Compaction output is an opaque item that must be carried forward unchanged; it is not portable conversation text.
- Prompt caching is automatic for eligible prompts. Cache hits require an exact stable prefix; tools and static instructions should therefore precede changing conversation content ([prompt caching](https://platform.openai.com/docs/guides/prompt-caching)).

**Gaps / design consequences**

- A response ID is convenient but makes replay/resume depend on server-retained state. die should persist every returned output item and be able to rebuild a stateless request. Treat `previous_response_id` as an optimization, not the only recovery record.
- The SDK provides transport and generated API types, not an agent loop, durable branch model, or die's job ownership semantics.
- Official API compaction is not the same protocol as die's current ChatGPT Codex `compaction_trigger` path. Implement and test them as separate capabilities.

### Anthropic Messages

**Verified support**

- The official Go SDK exposes Messages, streaming accumulation, typed content blocks, tool use, retries, request options, and error/status types ([SDK README](https://github.com/anthropics/anthropic-sdk-go), [tool helpers](https://github.com/anthropics/anthropic-sdk-go/blob/main/tools.md)).
- Tool use is a protocol loop: preserve the assistant `tool_use` block and return a user `tool_result` with the matching ID ([tool-use docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)). Extended-thinking/signature blocks also need lossless round-tripping.
- Prompt caching supports top-level automatic caching and explicit `cache_control` breakpoints, with 5-minute and 1-hour TTL choices; cache creation/read usage is reported ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- Anthropic now documents server-side compaction as beta `compact-2026-01-12`. It emits a `compaction` block, and subsequent requests append the prior response so the API can discard content before that block ([compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)). Context editing can also clear selected old tool results/thinking ([context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)).

**Gaps / design consequences**

- Compaction is beta and model/endpoint coverage can differ. Gate it by an explicit capability table and retain the complete local transcript.
- Do not normalize Anthropic blocks to text. Cache controls, tool IDs, thinking signatures, and compaction blocks belong in the provider projection.
- Keep die's plaintext summarizer as a visible fallback; never silently present fallback as server compaction.

### Google Gen AI

**Verified support**

- `googleapis/go-genai` is Google's official unified Go SDK for both the Gemini Developer API and Vertex AI ([repository](https://github.com/googleapis/go-genai), [Go reference](https://pkg.go.dev/google.golang.org/genai)). It supports content generation, streaming, chats, function calling, and explicit cached content.
- Function calls and function responses are structured Parts and must remain correlated in conversation history ([function calling](https://ai.google.dev/gemini-api/docs/function-calling)). Streaming is exposed by `GenerateContentStream` ([text generation](https://ai.google.dev/gemini-api/docs/text-generation?lang=go)).
- Gemini offers implicit caching on supported models and explicit caches with a cache resource/TTL; explicit caching has model-specific minimum input sizes ([caching](https://ai.google.dev/gemini-api/docs/caching?lang=go)).

**Gaps / design consequences**

- No authoritative Google source found in this research describes a general Gemini equivalent to OpenAI/Anthropic server-side conversation compaction. Use die's portable summarizer for Google until a documented API capability exists.
- Developer API and Vertex use different authentication/configuration and can differ in feature availability. Model capability discovery must include backend, not only model name.
- Chat helpers are convenience state holders. Persist canonical Contents/Parts and reconstruct them after restart rather than relying on an in-memory chat object.

## Framework comparison

| Choice | Verified useful support | Fit for die | Important gaps |
|---|---|---|---|
| Direct official SDKs | First access to vendor event/block types, streaming, tools, usage, cache and beta knobs | **Best core**. Thin adapters leave die in control of persistence, job ownership and provider-native state | Three protocols and capability tables must be maintained |
| [Google ADK Go](https://github.com/google/adk-go) | ADK documents agents, tools, streaming, multi-agent composition, session/state/artifact services; session docs describe in-memory and persistent services and concurrency/locking concerns ([sessions](https://google.github.io/adk-docs/sessions/session/), [multi-agent](https://google.github.io/adk-docs/concepts/multi-agent/)) | Useful reference if die later wants declarative workflows or Google-hosted agent deployment | Opinionated Runner/Event/Session model overlaps die's tree sessions and process jobs. Language support varies by feature in ADK docs. It does not establish lossless parity for all three provider-specific protocols |
| [CloudWeGo Eino](https://github.com/cloudwego/eino) | Go-native components, ChatModel/tool interfaces, streaming composition, graphs, callbacks, and checkpoint/interrupt hooks ([overview](https://www.cloudwego.io/docs/eino/overview), [checkpoint/interrupt](https://www.cloudwego.io/docs/eino/core_modules/chain_and_graph_orchestration/checkpoint_interrupt)) | Potentially useful later for a bounded workflow inside one agent | Graph checkpoints are execution-state persistence, not die's complete conversational journal. Provider extension packages add another release/translation layer. Eino ADK material observed by the search includes preview/alpha surfaces |

Neither framework should own the initial provider boundary. If adopted later, invoke it *above* die's adapter/event contracts so sessions remain readable without the framework.

## Provider adapter contract

Use one internal stream vocabulary for orchestration/UI, while also retaining raw provider blocks:

- request started / response headers observed;
- text delta, reasoning delta (when providers expose it), and completed content item;
- tool-call started, argument delta, completed tool call;
- usage update and terminal completion/error;
- provider continuation token/response ID;
- opaque provider state (reasoning signatures, compaction items, cache metadata).

Rules:

1. Persist completed provider items in lossless, versioned envelopes: provider, API family, model, SDK/schema version, raw JSON, and normalized searchable text/tool metadata.
2. Never execute a tool from partial argument deltas. Validate completed JSON against die's schema, persist the accepted call, then run it.
3. If several independent tool calls arrive together, execute with a bounded worker group but persist/results-submit in original call order unless that provider explicitly permits otherwise.
4. Drive every SDK request and tool with a `context.Context`. Distinguish caller cancellation, deadline, transport failure before headers, provider rejection, and failure after a possibly billable response.
5. Capture usage from terminal events and retain failed/cancelled billable attempts separately, matching current die behavior.
6. Keep adapter-owned request projection functions deterministic and fixture-test serialized requests, SSE/event parsing, resume, cache boundaries, and model switching.

Avoid a “lowest common denominator” message model. It is acceptable for normalized UI/search fields to be lossy; the provider envelope cannot be.

## Authentication and the Codex subscription caveat

**Verified**

- The OpenAI API and official Go SDK use API credentials; API usage is billed separately from ChatGPT subscriptions ([Codex authentication](https://developers.openai.com/codex/auth), [SDK configuration](https://github.com/openai/openai-go#configuration)).
- OpenAI's own Codex clients support “Sign in with ChatGPT,” and Codex usage is included in eligible ChatGPT plans ([Codex authentication](https://developers.openai.com/codex/auth), [Codex plan availability](https://help.openai.com/en/articles/11369540-codex-in-chatgpt)).
- Current die does not use the official OpenAI API for that lane: Pi registers an OpenAI-Codex OAuth flow, and die's native compactor targets `https://chatgpt.com/backend-api/codex/responses` by default.

**Not verified / do not assume**

- The official Go SDK does **not** document “Sign in with ChatGPT” as a general OAuth grant for third-party applications, nor the ChatGPT backend as a supported public API contract.
- The sources above do not grant a rebuilt die permission to copy Codex CLI client IDs, token exchange behavior, headers, or subscription entitlements. Technical compatibility is not evidence of support or durable authorization.
- Therefore, do not promise subscription login in the Go rebuild until OpenAI provides an applicable integration contract or the project obtains explicit approval. Terms/legal review is required; this research is not legal advice.

Practical product split:

1. Ship `openai-api` using the official SDK/API key as the supported OpenAI provider.
2. Put subscription Codex behind a separately named experimental build/adapter, with no fallback that could unexpectedly charge an API key.
3. Store refresh tokens only in an OS keyring where available (or a mode-0600 encrypted/clearly disclosed fallback), serialize refresh per account, and pass short-lived credentials to children rather than copying token files. Never write secrets to session JSONL or diagnostics.
4. Treat Claude/Gemini consumer-subscription OAuth similarly: an official vendor CLI login is not automatically a public authentication surface for die.

## Caching strategy

Caching should be a provider projection concern, with provider-reported counters as truth:

- Build requests as a stable prefix (system/developer instructions, tool schemas, project memory), then append changing conversation state. Canonicalize tool schema ordering and JSON serialization.
- Anthropic: use documented automatic top-level caching first. Add explicit breakpoints only where measurements justify them; select 1-hour TTL deliberately because writes cost differently.
- OpenAI: rely on documented automatic caching and optional documented cache-routing fields; there is no Anthropic-style explicit block marker to emulate.
- Google: create explicit cache resources only for sufficiently large, reused, immutable prefixes; persist cache name, backend/model, expiry and source digest. Recreate on expiry/mismatch.
- Preserve die's cache countdown only as an estimate. Label it as such. Reset from a request/response observation according to a documented policy, but show actual cache-read/write tokens separately.
- Cache identity must include provider, API/backend, model, account/project where relevant, request prefix digest, tool definitions, and provider options. Never infer a hit from elapsed time.

## Compaction and model switching

Maintain three distinct mechanisms:

1. **Provider-native checkpoint**: OpenAI opaque compaction item; Anthropic beta compaction block. Store unchanged and replay only through a compatible provider/API/model capability lane.
2. **Portable plaintext checkpoint**: die-generated summary plus structured working state (goals, files read/changed, pending jobs, unresolved tool calls). This is the cross-provider fallback.
3. **Lossless archive**: the complete pre-compaction event history and tool output remains locally available for branch navigation, audit, export, and re-summarization.

A session branch should have provider-specific projections/checkpoints. On a model/provider switch, select the newest compatible native checkpoint; otherwise create or reuse a portable checkpoint and clearly report the transition. Never send an OpenAI encrypted item to Anthropic/Google, flatten signed thinking blocks, or mistake a placeholder notice for a semantic summary.

Automatic compaction must be single-flight per session. Snapshot the branch leaf and model identity before inference; commit only if they still match. Persist attempt/usage even when a response becomes unusable. After a potentially billable ambiguous failure, cancel and ask the user to retry rather than silently doing a second summary—the conservative behavior current die already implements.

## Persistence

For the first Go version, keep **append-only JSONL as the canonical session record** and optionally maintain SQLite/FTS as a rebuildable index. This preserves inspectability, crash recovery, branch history, existing exports, and one-file-per-child isolation without putting the first release behind a database migration.

Recommended records:

- immutable session header/version;
- user/provider/tool events with IDs, parent IDs and timestamps;
- model/auth-profile changes (profile reference only, never credentials);
- compaction attempt/checkpoint and usage records;
- child launch, parent-session link, PID/process identity, completion/notification ownership;
- cache observation metadata;
- large binary/tool-output artifact references with digest and bounded inline preview.

Use one writer goroutine (actor) per session, append + flush at semantically durable boundaries, and recover by ignoring/quarantining only a torn final line. Use advisory ownership/lock files to reject two writers to one session. Parent and children normally write different files, so no cross-process append lock is needed. Build search/history indexes asynchronously from committed offsets and make them disposable.

SQLite can become canonical later if transactions across many sessions become necessary. If so, use WAL, one logical writer queue, immutable event rows, explicit schema migrations, and external content-addressed blobs; do not replace the event model with mutable “current message” rows.

## Concurrency and lifecycle

- Keep one OS process per subagent for fault isolation, independent cancellation/process groups, and durable session identity. The supervisor owns child lifecycle; the child owns its session/provider loop.
- Add configurable semaphores: total child processes, requests per provider/account, and tool workers per agent. Queue rather than launching an unbounded `prompts` batch.
- Preserve current delegation policy as a capability passed by the supervisor, not session metadata a resumed child can elevate.
- Persist child identity before spawn. On restart, reconcile recorded PID/start identity, mark unrecoverable children orphaned, and deliver durable completion once—never infer a live child solely from PID reuse.
- Separate “caller stopped waiting” from “cancel the job.” Stream/UI backpressure must not block provider reads or child stdout; use bounded buffers and durable offsets as die does now.
- For shell tools, terminate process groups and retain grace-then-kill semantics. For provider streams, close response bodies and wait for parser goroutines to exit.

## Suggested delivery order (proposal)

1. Define durable events, provider envelopes, projection rules, and golden session fixtures (including current Pi JSONL import).
2. Implement OpenAI API-key/Responses adapter end-to-end: streaming, multiple tools, cancellation, usage, cache counters, stateless resume.
3. Implement Anthropic, including signatures/cache markers; keep beta compaction feature-gated.
4. Implement Google Developer API, then Vertex as a separate backend capability profile.
5. Port process supervisor/job ownership and only then enable concurrent subagents.
6. Add portable compaction; add documented OpenAI native compaction and Anthropic beta compaction independently.
7. Evaluate frameworks only after parity tests pass. Reconsider Eino for isolated workflows, not provider/session ownership.
8. Decide subscription Codex separately after support/authorization review; it must not block the official API-key product.

## Evidence files

Tavily CLI search outputs were distilled into focused, reviewable files (result URLs, scores, search excerpts, and relevant raw excerpts):

- [OpenAI Go/Responses](sources/llm-openai-go-responses.md)
- [Anthropic Go](sources/llm-anthropic-go.md)
- [Google ADK Go](sources/llm-google-adk-go.md)
- [Eino](sources/llm-eino.md)
- [Google Gen AI Go](sources/llm-google-genai-go.md)
- [Codex auth/subscription](sources/llm-codex-auth.md)

## Bottom line

Official SDKs plus a die-owned event/session/tool runtime are the lowest-risk route to behavioral parity. The framework route appears shorter only if die gives up the exact provider state, conservative billing/cancellation semantics, branchable persistence, and process-supervised agents that distinguish it from a generic chatbot.
