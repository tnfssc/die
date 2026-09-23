# Compaction and cache reuse — investigation

Status: Phase 1 and Phase 2 built and checked. Later current-conversation plaintext revision replaces Phase 1 old snapshot-eligibility rules. Source changes built but not installed. Installed release still v0.2.3. Work studied Pi 0.85.0.

Research date: 2026-09-05. The comparison used official docs and Codex source at commit 588b781ab4924ce7352488394028e63d74cf807f. Public docs and defaults can change.

## Direct evidence from die

The current parent session has three default compaction records:

| Compaction (UTC) | Uncached input | Cached input | Output | Client-recorded cost |
| --- | ---: | ---: | ---: | ---: |
| 04:18:11 | 94,926 | 0 | 2,956 | $1.09706 |
| 06:03:31 | 95,501 | 0 | 3,417 | $1.12586 |
| 13:52:09 | 54,510 | 0 | 4,023 | $0.74625 |

Total: 244,937 uncached input tokens and $2.96917 recorded cost. Numbers come from client usage and price records. They are not provider billing audit. Normal responses right before reported 241,920, 253,696, and 152,448 cached input tokens. Third came after several idle hours. It does not prove earlier cache entry still existed when compaction ran.

Offline run sent production Pi summarizer through production Codex serializer. It confirms payload mismatch. Fixture-only artifacts:

- artifacts/compaction/capture.ts
- artifacts/compaction/provider-payloads.json

Capture intercepted onPayload, used dummy JWT, and checked zero fetch calls. This proves serializer-boundary behavior. It does not show live provider traffic.

| Component | Ordinary fixture request | Default compaction |
| --- | --- | --- |
| Instructions | Normal agent system prompt | Different summarizer system prompt |
| Input | Native user message, function call, function output | One user message containing a flattened transcript |
| Tools | Execute definition | No tool definitions |
| Prompt cache key | Stable session key | Omitted in serialized JSON |
| SDK options | Normal session | cacheRetention: none and fresh routing session ID |

Text transcript cuts tool results. It is not byte-for-byte copy of original messages. Turning cache setting back on cannot fix prefix changes. SDK cache policy names are not universal provider cache-disable switch. Exact sent fields matter.

## Candidate evaluation criteria

Cache-affine summary fork must keep **actual model-facing** instructions, native message encoding, tool definitions/order, model, and cache identity. Then append summary request after existing prefix. Do not rebuild prefix from nominal base prompt and assume match. Check each provider-specific parameter, including tool choice and thinking settings, for cache invalidation.

Summary fork must not dispatch tools. Keeping schemas for prefix identity and running tools are different choices.

Measure three phases apart: normal request, summary request, first resumed request. Compaction changes conversation prefix for continuation. Cache hit during summary does not mean whole old history stays reusable later.

Compare warm/cold caches, manual/threshold/overflow triggers, split turns, model switches, cancellation, bad summaries, and recent tool-call/result boundaries. Keep pending job IDs/ownership, user constraints, open failures, file state, and last actionable request. Keep durable JSONL history and saved summary usage/costs.

Example input-only break-even: native request F tokens, flattened request S tokens, cached-input price fraction r of uncached, native hit fraction h. Native input costs less when h > (1 - S/F) / (1-r). At F=250k, S=95k, and r=0.1, hit rate must exceed about 69%. With fully warm cache and example $10/M uncached, $1/M cached, inputs cost $0.25 versus $0.95. This leaves out new suffix, output, retries, cache-write charges, and post-compaction warm-up. It is not measured saving or universal price claim.

## What Pi sends and keeps

Active path is pi-coding-agent classic AgentSession. It is not separate new pi-agent-core harness code. Source paths below are under node_modules:

- @earendil-works/pi-coding-agent/dist/core/agent-session.js:1451–1454,
  1495–1543, 1756–1830: direct summarizer calls, hooks, persistence/rebuild.
- @earendil-works/pi-coding-agent/dist/core/compaction/compaction.js:440–515:
  options and standalone request construction; 609–666: split-turn summaries.
- @earendil-works/pi-coding-agent/dist/core/compaction/utils.js:72–141:
  transcript serialization, 2,000-character tool-result truncation, summary system prompt.
- @earendil-works/pi-ai/dist/api/openai-codex-responses.js:169–171, 371–427:
  cacheRetention:none discards the session cache identity; wire payload construction.
- @earendil-works/pi-coding-agent/dist/core/session-manager.js:191–236,
  817–832: summary plus retained entries, append-only checkpoint persistence.

Pi uses current session model, not cheaper dedicated model. Default request has summary-only system prompt and one user message. User message has conversation text, optional old summary, summary-format instructions, and optional manual focus instructions. It calls normal provider inference API, not provider-native compact endpoint. In Codex SSE mode, hiding cache identity also drops session-id/x-client-request-id headers. Fresh SDK UUID is not usable cache identity in sent request.

It gets normal assistant result. It rejects provider errors, incomplete length-limited replies, and tool calls. It takes text and records usage. Split turn may need two summary calls. Usage joins into one compaction record. Structured summary includes goals, constraints, progress, decisions, next steps, critical context, and file-operation lists.

Checkpoint stores summary, firstKeptEntryId, tokensBefore, details, and usage. Later requests see normal system prompt + fake summary user message + retained recent messages. Default keepRecentTokens is about 20k. Auto-compaction reserves 16,384 tokens before model context limit. Do not confuse current tail setting with different Codex retained-message policies.

The computed summary output limit is approximately 80% of reserveTokens, capped
by model.maxTokens. However, this Codex serializer does not emit a max-output
field, so that computed cap is not enforced on this provider path.

Default compaction skips before_agent_start and normal context transform. It also misses normal Agent-level payload/response callbacks. Header hooks still run through SDK stream wrapper. So normal-request telemetry misses key compaction facts. session_before_compact can provide replacement checkpoint for manual and automatic paths without patching node_modules. At research start this looked like integration seam but was not built yet. Implementation sections below say how it was later used and changed.

The installed session-format documentation also describes a different harness
retainedTail representation. That is not the checkpoint format currently used by
die's instantiated coding-agent path.

## Claude Code: explicitly cache-affine client-side compaction

Anthropic's official [Claude Code prompt-caching documentation](https://code.claude.com/docs/en/prompt-caching#compacting-the-conversation)
explicitly says:

> To produce the summary, Claude Code sends a separate request with the same
> system prompt, tools, and history as your conversation, plus a summarization
> instruction appended as a final user message.

Thus the conceptual Messages request is:

    same model/system/tools + same native history + final user summary instruction
    -> ordinary assistant summary

Docs say warm request reads existing prefix from cache. Cold request reprocesses full history at uncached rates. Exact private summary prompt and full CLI wire envelope are not public. Shape above is directly documented, not guessed from closed binary.

After compaction, Claude Code replaces old conversation with summary. It keeps system layer and reloads project context. Context hits cache only when reloaded instructions/memory are unchanged. Continuation rebuilds shorter conversation cache. Caching does not keep omitted context for model or reduce context-window use.

[What survives compaction](https://code.claude.com/docs/en/context-window#what-survives-compaction)
distinguishes lossy summarization from deterministic re-injection: root CLAUDE.md,
unscoped rules, memory and plans are reloaded; selected recent files and invoked
skills are reintroduced under documented caps. Earlier hook content is generally
summarized; compact-session hooks can restore fresh state. These practices are as
important to quality as the summarization prompt itself.

[Claude prompt-cache semantics](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
are prefix-based across tools, system, and messages. Cache-control breakpoints,
TTL, model/thinking/tool-choice changes, write costs, and block lookback all matter.
Changing the tool-choice option to prevent tool use can invalidate message-level
reuse; retaining schemas does not require dispatching any returned calls.

### Separate feature: Anthropic server-side API compaction

Do not conflate Claude Code's documented separate call with this API feature.
The [API compaction guide](https://platform.claude.com/docs/en/build-with-claude/compaction)
documents the beta header compact-2026-01-12 and a normal Messages request with:

    "context_management": {
      "edits": [{
        "type": "compact_20260112",
        "trigger": {"type": "input_tokens", "value": 100000}
      }]
    }

At the threshold the server summarizes and returns a content block:

    {"type": "compaction", "content": "Summary ..."}

By default it continues task inference in the same call. Setting
pause_after_compaction:true returns after the summary with stop_reason:compaction.
The next request passes back the compaction block; the server excludes content
before it from the effective model context. Custom summary instructions replace,
not supplement, this API feature's default instructions. This does not establish
how Claude Code combines its own custom /compact instructions.

Same requested model does API summary. usage.iterations separates compaction and later message iterations. Top-level token counts leave out compaction iteration usage. Future integration must add correctly without double-counting message use. API recommends stable system cache breakpoint. It may mark compaction block for later reuse.

## Codex: native compaction, plus a local fallback

Pinned source: [openai/codex 588b781](https://github.com/openai/codex/tree/588b781ab4924ce7352488394028e63d74cf807f). This covers that source version. It does not cover every released CLI or compatible gateway.

### Default remote V2 on supported providers

The remote_compaction_v2 feature is stable and enabled by default in
[features/src/lib.rs:1719–1724](https://github.com/openai/codex/blob/588b781ab4924ce7352488394028e63d74cf807f/codex-rs/features/src/lib.rs#L1719-L1724).
The [request builder](https://github.com/openai/codex/blob/588b781ab4924ce7352488394028e63d74cf807f/codex-rs/core/src/compact_remote_v2_attempt.rs#L67-L110)
retains native history, base instructions and model-visible tools, and appends:

    {"type": "compaction_trigger"}

It streams through normal Responses endpoint. It keeps normal model, reasoning config, and session-derived prompt_cache_key. Public API also defines this trigger as last input item. It is not private Codex protocol guessed from source.

The client expects exactly one encrypted compaction output item:

    {"type": "compaction", "id": "cmp_...", "encrypted_content": "..."}

It constructs replacement history from selected retained local messages plus
that item. The pinned implementation uses a 64k retained-message budget and caps
individual retained agent messages at 10k tokens. See
[compact_remote_v2.rs:422–515](https://github.com/openai/codex/blob/588b781ab4924ce7352488394028e63d74cf807f/codex-rs/core/src/compact_remote_v2.rs#L422-L515).
The server's hidden summary representation, internal algorithm/model and quality
selection are not public. An opaque item is not a plaintext Pi summary.

### Standalone /responses/compact

The legacy Codex remote path calls a separate compact endpoint and sends model,
native input, instructions, tools, reasoning and the same cache key. It differs
from the newer trigger-based path, but is still a hosted compaction operation.

The [public standalone API](https://developers.openai.com/api/docs/api-reference/responses/compact)
returns a response.compaction envelope with id, output array, and usage—not merely
an assistant string. Output can include retained ordinary messages alongside the
encrypted compaction item. Public API clients should pass the complete returned
output onward unchanged, as instructed by the [compaction guide](https://developers.openai.com/api/docs/guides/compaction).
Codex's legacy implementation deserializes only output and applies its own
version-specific history filtering; that should not be copied as generic API
advice. Its compact request carries the same session-derived cache key.

The public API also supports automatic in-line compaction on /responses through
context_management:[{type:compaction,compact_threshold:...}]. The server emits a
compaction item and continues inference; this is distinct from an explicit
standalone request. In stateless use, send the output items back. In stateful use,
previous_response_id carries conversation state; prompt_cache_key does not.

### Local fallback

Unsupported providers use normal model summary, not hosted opaque compaction. Local means client-run flow. It does not mean inference runs on device. [local compaction source](https://github.com/openai/codex/blob/588b781ab4924ce7352488394028e63d74cf807f/codex-rs/core/src/compact.rs#L248-L400) starts separate turn with dedicated summary prompt and no tools. It serializes native Responses items through normal client. This Prompt has no normal tool list, so it does not match Claude Code tool-prefix-keeping flow.

Text reply becomes summary user message. It keeps recent real user messages under about 20k total budget and adds canonical initial context again. This differs from Pi 20k recent mixed-role/tool tail. Codex saves replacement history in append-only rollout checkpoint for resume.

## OpenAI cache implications

The [current prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
describes rendered-prefix reuse, not a server conversation lookup. A stable
prompt_cache_key helps routing/grouping; it does not pin a server, guarantee a
hit, retrieve earlier messages, or replace previous_response_id.

Preserve model and prefix-affecting parameters, native history and tool order.
Changing system/developer messages, tools, reasoning configuration, output format,
or content before a matching breakpoint can defeat reuse. Cache availability also
depends on TTL, eviction, organization/region and routing.

Do not assume the older 'no cache-write surcharge' rule applies universally.
The current guide distinguishes GPT-5.6+ breakpoint/TTL controls and cache-write
pricing from earlier models; it documents 1.25x input pricing for writes and 0.1x
for reads on that newer path. Cached reads and writes are reported separately in
input_tokens_details.cached_tokens and cache_write_tokens. The installed Pi
Responses parser already maps both fields (openai-responses-shared.js:441–448).
Account/backend/model compatibility and current pricing must be checked before a
live cost experiment, especially for Codex subscription versus public API use.

At research time guide and API reference disagreed on max read-breakpoint count: 50 versus 80. Do not rely on either without checking. Core prefix-preservation result is unchanged.

## Historical agreed implementation sequence

User choice: build Claude-style compaction first. Then build Codex-native compaction as intended Codex-provider path, not endless optional idea. User puts Codex native compaction quality first. This is product requirement, not measured quality result from this research. This is staged delivery, not choice to leave native path out.

### Phase 1 — Claude-style cache-affine plaintext compaction

Build portable prefix-keeping summary path first. It is not final Codex provider compaction. Keep provider strategy apart from checkpoint/lifecycle plumbing. Then native path can come without rewriting shared flow.


1. Prototype a **cache-affine plaintext compaction fork**, following Claude Code's
   documented pattern, rather than only flipping cacheRetention. Preserve the
   actual ordinary request prefix and append the summary task as a suffix.
2. Keep the model/provider identity and prefix-affecting options stable. Capture
   the real post-hook context and provider serialization; don't assume a nominal
   base-system getter reconstructs the same request.
3. Retain Pi's durable checkpoint, cancellation/error handling, usage accounting
   and tool-call/result-safe boundary logic. Specify exactly which messages the
   summary covers versus which tail is replayed; avoid silently overlapping them.
   Restore stable project instructions and live job-ownership facts explicitly.
4. Start early enough that native context + summary instruction + output budget
   fit. Cached tokens still occupy context. For genuine overflow, cold cache, or
   unsupported configurations, keep a deliberate fallback rather than blindly
   resending an oversized or expensive full history.
5. Compare warm and cold A/B runs and the first resumed call, measuring cached
   reads, writes, uncached input, output/reasoning, latency and task-state quality.
   Quality gains from retaining full tool outputs are plausible, not proven.
### Phase 2 — Codex-native compaction (historical plan; now implemented)

Implement provider-native compaction for the Codex provider, using the supported
Codex-style request/response flow for the actual backend. Preserve native opaque
compaction items through serialization, checkpoints, and resume; do not convert
them into a plaintext summary or put encrypted content into Pi's summary string.

Need capability/auth matching, right token and cost counts, retained-history rebuild, cancellation/retry behavior, and direct cross-provider resume/model-switch handling. Test quality and cost on actual provider. Do not assume source/API parity. Interim plaintext behavior or unsupported-backend fallback must look different from successful native compaction.

At this planning milestone, Phase 2 was deliberately deferred until after Phase 1 but remained required. The later “Phase 2 implemented” section preserves the completed implementation and evidence; this paragraph is not a current status claim.

Research changed no production code, provider behavior, or install. Outside sources were public. Serializer experiment made no model request. Detailed worker wisdom is in artifacts/compaction/.

## Phase 1 implementation and evidence

Production: `src/tasks/cache-affine-compaction.ts`, wired from
`src/tasks/extension.ts`. Editable prompt sources: `src/prompts/compaction.md`
and `src/prompts/compaction-jobs.md`. No node_modules patches or new tool names.

- Captures the final chained context, effective system prompt, active tool
  definitions, model/thinking/session identity, provider payload and header
  overrides. The summary task is appended after the native conversation.
- Uses the resolved provider's simple-option mapper. Pi's extension registry
  exposes complete() but delegates to native-option streaming; passing only a
  generic reasoning level there silently loses provider-specific thinking fields.
  Actual SDK/serializer tests caught this; isolated mocks did not.
- Validates the prior token-bearing provider prefix and cache-affecting fields
  before inference. Anthropic conversation cache-marker relocation is allowed
  only with unchanged policy/count; semantic tool-input keys are never stripped
  as cache metadata. Routing/project headers are preserved; dynamic credential
  overrides that cannot be safely reused require standard fallback.
- Keeps Pi's checkpoint and retained-tail boundaries. The suffix includes a
  bounded visible tail anchor because application message numbers are not always
  identical to provider wire-item numbers. Template substitutions are single-pass
  so custom instructions remain literal.
- Accounts for transformed input growth and leaves room for unchanged Anthropic
  thinking budgets plus summary output. No returned tool call is dispatched.
- Successful summaries retain usage, file-operation details and strategy/version.
  Runtime-owned running job IDs are appended deterministically at checkpoint time.
- Preflight failures use the standard path with a warning. Once inference may be
  billable, an unusable response cancels compaction rather than silently launching
  duplicate inference. Available failed-response usage is persisted as a
  die-compaction-attempt entry and included in root/descendant footer totals.

### Explicit limits

This is not a claim of cache hits on every compaction. A restart before any new
request, stale branch/model/thinking identity, unsupported provider payload shapes
or options, or insufficient context space can select the standard fallback. A
cache entry can expire even when the payload remains eligible.

Arbitrary context transformations cannot safely be replayed through the extension
API. New raw user/tool/image entries therefore require fallback rather than
bypassing redaction or image-blocking policy. An unmodified captured prefix may
be extended with a safe text/thinking-only assistant response. This means some
between-tool automatic compactions still use the standard path. Branch summaries
are unchanged. At this Phase 1 milestone, native Codex compaction remained required Phase 2 work; it is implemented in the later section.

### Validation and retained failures

- The initial seven isolated unit tests passed, but the first SDK/serializer
  tests failed on both providers. Those were real integration failures, not
  successful cache-affine runs. Follow-up tests now exercise actual Anthropic
  and Codex serializers, real SDK lifecycle/checkpoints, thinking configuration,
  cache identity, routing headers, and zero network calls.
- The initial full suite also exposed a separate SIGTERM fixture race. A fixed
  25ms delay could fire before the login shell installed its trap. A bounded
  readiness handshake now replaces the delay; the original SIGKILL assertion
  remains. No task-manager production behavior was changed for that failure.
- Unit coverage includes stale/transformed boundaries, unsafe suffixes, overflow,
  cancellation and unusable results, failed-attempt accounting, template safety,
  and deterministic running-job state.

Two one-shot live synthetic probes were retained (no retries to obtain a hit):

| Probe | Cached input | Uncached input | Summary total cost | Baseline total cost | Summary / baseline latency |
| --- | ---: | ---: | ---: | ---: | --- |
| Initial fixture | 9,728 | 1,063 | $0.00104676 | $0.00069080 | 11.49s / 7.23s |
| Strengthened fixture | 9,728 | 1,259 | $0.00094556 | $0.00072680 | 10.08s / 7.81s |

Artifacts: `artifacts/compaction/live-1788620476772.json` and
`artifacts/compaction/live-1788620815677.json`. The initial baseline exercised
Pi's flattened summarizer; the strengthened fixture invokes Pi's full default
compact() on the same preparation and additionally checks tail exclusion and
correct resumed recall. Neither probe is a broad task-quality benchmark.

Both cache-affine summaries preserved a fixture value located beyond Pi's
2,000-character tool-result truncation; neither baseline preserved its exact
value. The strengthened run excluded a retained-tail-only sentinel and answered
correctly after resume. Its summary request had about 88.5% cached input, while
the first resumed request had zero cache reads, as expected for a changed history.

**These small fixtures did not demonstrate cost savings.** The strengthened
cache-affine summary cost about 30% more than the much shorter, information-losing
baseline. These are client-recorded rates, not billing audits. Cache reuse and
improved fact retention were demonstrated; universal cost or latency improvement
was not. The original larger-session savings hypothesis remains workload-dependent.

Opt-in reproduction: DIE_RUN_LLM_TESTS=1 bun test tests/cache-affine-compaction-live.test.ts

Final deterministic validation: **186 passed, 11 opt-in skips, 1,024 assertions
across 42 files**. Typecheck, standalone build, smoke test and diff checks passed.
Two live synthetic probes passed as described above. Built, not installed.


## Phase 2 implemented: native Codex Responses compaction

Production Codex now uses `src/tasks/native-compaction.ts` rather than the
Phase 1 plaintext adapter when a safe ordinary-request capture exists. The live
backend accepted POST to the ordinary Codex `/responses` endpoint with the
unchanged instructions, tools, reasoning, model and cache key, and a final
`{"type":"compaction_trigger"}` input item. This is remote V2, not a call to
`/responses/compact`, and not plaintext labeled as native.

The response must contain exactly one opaque `compaction` item. The complete
item is saved in versioned `CompactionEntry.details` with provider/model identity
and available usage. Its ciphertext is never put in the summary string. A
version-pinned compatibility adapter carries it transiently through the installed
Responses serializer's `thinkingSignature` replay implementation. This is an
internal adapter, not an upstream promise that Pi supports compaction items.
Actual serializer tests verify exact replay; a runtime guard cancels requests if
the opaque item disappears during conversion.

### Safety and scope

- Auth is resolved through the registry; fresh OAuth/account headers, effective
  base URL, routing headers and the ordinary cache identity are preserved. The
  dedicated request is HTTP SSE even if ordinary traffic used WebSockets.
- Raw JSONL history remains intact. Pi's existing retained-tail boundary is used;
  every discarded message must be covered by the captured request. This does not
  reproduce Codex's separate client-side 64k retention algorithm.
- Disk resume and repeated native compaction work. Different providers/models,
  damaged or unknown checkpoint versions, and lossy branch summarization are
  blocked. Thinking-level changes are allowed for ordinary replay; stale
  compaction captures are still rejected. Navigation without a branch summary
  remains available, including branching before a checkpoint.
- No tool output is dispatched during compaction. Reads are bounded to 8 MiB,
  cancellation is propagated, and unusable native responses do not cause a second
  hidden plaintext inference. Available failed/cancelled usage uses the existing
  `die-compaction-attempt` accounting path, including footer/descendant costs.
- A custom focus or unavailable capture can select Pi plaintext compaction only
  before opaque state exists. Existing opaque checkpoints are preserved instead
  of being flattened into a meaningless placeholder. Manual compaction directly
  after resume may therefore cancel until a normal request has captured context.
- Runtime-owned job facts are deterministically saved beside the opaque item and
  replayed as ordinary context, explicitly without a restart-survival promise.
  The editable display notice is `src/prompts/native-compaction.md`.
- Pi's immediate post-checkpoint token estimate cannot inspect encrypted state;
  the next ordinary provider response supplies actual usage. Third-party hooks
  that alter the final payload after die's hook remain an integration boundary.

### Independent evidence

`tests/phase2-native-sdk.test.ts` exercises the production extension and actual
serializers with network disabled for ordinary calls: OAuth headers, native/cache
fields, repeat compaction, real JSONL reopen, incompatible provider/model guards,
uncaptured discarded data, and billable failures. Phase 1's Codex tests now use a
test-only Phase 1 fixture; they do not disable native compaction in production.

The first live probe, `artifacts/compaction/native-live-1788628149009.json`,
successfully compacted and resumed with the correct fact, then failed the extra
repeat step because the resumed conversation was too small for Pi to compact.
That failure is retained. The fixture was enlarged to exercise an eligible repeat
rather than treating that preflight exception as native success.

The strengthened single-shot probe passed:
`artifacts/compaction/native-live-1788628612135.json`.

- First native checkpoint: 7,680 cached / 711 uncached input (~91.5% cached),
  93 output tokens, client-estimated cost $0.00040740, 2.904 seconds.
- Fresh SDK session from disk, using SSE: recalled `cedar-marble-842`, which was
  absent from the retained plaintext tail. That ordinary request had no cache hit.
- Second native checkpoint accepted the previous opaque item: 2,560 cached /
  969 uncached input, 85 output tokens, estimated cost $0.00034700.

Artifacts retain usage, lengths/hashes and fixture answers, not credentials,
ciphertext or hidden reasoning. This proves live native output, cache reuse,
replay and this fixture's fact retention—not universal quality or cost superiority.
No comparable head-to-head savings benchmark was run for Phase 2.

Reproduce with:

```sh
DIE_RUN_LLM_TESTS=1 bun test tests/phase2-native-live.test.ts
```


## Current-conversation plaintext revision (version 4)

This supersedes the Phase 1 snapshot-eligibility rules above for the plaintext
strategy. Native Codex compaction is unchanged.

The old implementation depended on reconstructing a prior request. That was an
implementation limitation, not a requirement of Claude-style compaction. The
revised path prepares the current branch using the owning classic AgentSession:

1. Reuse the effective warm-turn frame without repeating before_agent_start
   side effects. Fresh/resumed preparation obtains its frame through that hook,
   including the latest user images; context hooks see the resulting frame.
2. Run the normal context transformation and conversion over current history,
   including newly arrived user/tool/image data, and obtain current active tools.
3. Append the summarization instruction and use the ordinary stream function,
   including registry auth, attribution/header hooks, provider serialization,
   payload hooks and response hooks. No normal agent turn or tool dispatch is
   used to obtain a capture.
4. Save the plaintext checkpoint at Pi's existing durable retained-tail boundary,
   with usage, file lists and deterministic runtime job facts.

Prior payload comparison is diagnostic only: `priorPayloadAffine` may be false
without changing strategies. Fresh preparation needs no previous wire capture.
If transformed history cannot identify the retained suffix exactly, summarize
the whole current model-facing conversation while retaining Pi's durable tail.
This can duplicate some recent information, but does not silently omit discarded
facts or insert raw, potentially redacted data as a boundary anchor.

Actual capacity and preparation failures now cancel the operation and preserve
the conversation. They do not fall back to Pi's raw flattened summarizer, which
could bypass the very context filters the current request just applied. Failed
or aborted inference still accounts available usage without an alternate paid
request. Token estimates include current frame/tools and fresh framing messages;
Anthropic thinking allowances use the installed provider's mapping, including
adaptive-thinking handling, with a final serialized ceiling check.

Pi has no public extension-level prepare-request API. The scoped adapter binds
its owning classic session through `_buildRuntime` and uses the existing runtime
pipeline; `bindCurrentCompactionSession` also supports explicit embedding. This
is a pinned-runtime compatibility seam, not a node_modules patch. Missing that
seam causes visible cancellation—not reliance on an old captured conversation.
The legacy pure request-builder helper remains for isolated regression tests but
is no longer a production fallback.

### Verification and retained evidence

- Independent real-SDK tests exercise fresh disk reopen, unseen/redacted tool
  results, changed prefixes, automatic compaction, transformed tail boundaries,
  empty filtered context, post-hook oversized output, frame visibility, hook
  counts, and a single inference path. Codex-native SDK regression remains intact.
- Early independent tests caught the remaining old-prefix rejection gate,
  repeated warm framing hooks, and fresh context observing the unframed prompt.
  Those failures were fixed rather than weakening the criteria. Fixture artifacts
  remain under `artifacts/compaction/current-sdk-failure-*`.
- `artifacts/compaction/current-live-1788632956201.json` passed once: compaction
  immediately after disk resume, ordinary recall, and another compaction after a
  newly appended tool result that had never appeared in a prior request. Both
  exact fixture values survived, redaction held, and exactly three provider
  payloads were prepared. This small probe had zero cache reads; eligibility
  does not guarantee availability.
- The unchanged warm-cache/retained-tail probe also passed once:
  `artifacts/compaction/live-1788633062301.json`. It read 9,728 cached / 1,089
  uncached input tokens (~89.9% cached), preserved `fern-copper-731`, excluded the
  retained-tail sentinel and resumed correctly. Estimated summary cost was
  $0.00077476 versus $0.00070400 for the shorter, information-losing default
  baseline. This is not a demonstrated savings result.

The live plaintext fixtures use Codex credentials with a test-only plaintext
strategy registration. Production Codex still uses native compaction. Anthropic
current-pipeline delivery is verified with its actual serializer offline, not
claimed as a live Anthropic cache measurement.

Prompt sources are `compaction.md`, `compaction-prefix-scope.md` and
`compaction-whole-scope.md` under `src/prompts/`, plus the shared job-state template.

```sh
DIE_RUN_LLM_TESTS=1 bun test tests/current-pipeline-live.test.ts
DIE_RUN_LLM_TESTS=1 bun test tests/cache-affine-compaction-live.test.ts
```
