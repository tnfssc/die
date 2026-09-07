# Compaction and cache reuse — investigation

Status: Phase 1 and Phase 2 were implemented and validated; the later current-conversation plaintext revision supersedes Phase 1's old snapshot-eligibility rules. These source revisions were built, not installed; the currently installed release is the older v0.2.3. Pi version investigated: 0.85.0.
Investigated 2026-09-05. Comparison verified against official documentation and Codex source at commit
588b781ab4924ce7352488394028e63d74cf807f. Public docs and defaults may evolve.

## Direct evidence from die

The current parent session has three default compaction records:

| Compaction (UTC) | Uncached input | Cached input | Output | Client-recorded cost |
| --- | ---: | ---: | ---: | ---: |
| 04:18:11 | 94,926 | 0 | 2,956 | $1.09706 |
| 06:03:31 | 95,501 | 0 | 3,417 | $1.12586 |
| 13:52:09 | 54,510 | 0 | 4,023 | $0.74625 |

Total: 244,937 uncached input tokens and $2.96917 in recorded cost. These are
client usage/pricing records, not a provider billing audit. The preceding normal
responses reported 241,920, 253,696, and 152,448 cached input tokens respectively.
The third followed a multi-hour idle period, so this does not establish that its
earlier cache entry remained available at compaction time.

An offline run of the production Pi summarizer through the production Codex
serializer confirms the payload mismatch. Fixture-only artifacts:

- artifacts/compaction/capture.ts
- artifacts/compaction/provider-payloads.json

The capture intercepted onPayload, used a dummy JWT, and asserted zero fetch
calls. This is serializer-boundary evidence, not live provider-wire observation.

| Component | Ordinary fixture request | Default compaction |
| --- | --- | --- |
| Instructions | Normal agent system prompt | Different summarizer system prompt |
| Input | Native user message, function call, function output | One user message containing a flattened transcript |
| Tools | Execute definition | No tool definitions |
| Prompt cache key | Stable session key | Omitted in serialized JSON |
| SDK options | Normal session | cacheRetention: none and fresh routing session ID |

The text transcript truncates tool results, so it is not even a byte-preserving
rendering of the original messages. Re-enabling a cache setting alone cannot
repair these prefix differences. SDK cache policy names are not a universal
provider-level cache-disable switch; the exact emitted fields matter.

## Candidate evaluation criteria

A cache-affine summarization fork should preserve the **actual model-facing**
instructions, native message encoding, tool definitions/order, model, and cache
identity, then append the summarization request after that existing prefix. Do
not reconstruct the prefix from a nominal base prompt and assume it matches.
Provider-specific parameters (including tool choice and thinking settings) must
be checked for their own cache invalidation behavior.

No tool executions should be dispatched from the summarization fork. Keeping
schemas for prefix identity and executing tools are separate decisions.

Measure three phases separately: ordinary request, summarization request, and
first resumed request. Compaction necessarily changes the conversation prefix
for continuation; a cache hit while generating the summary does not mean the
entire old history stays reusable afterward.

Compare warm and cold caches, manual/threshold/overflow triggers, split turns,
model switches, cancellation, malformed summaries, and recent tool-call/result
boundaries. Preserve pending job IDs/ownership, user constraints, unresolved
failures, file state, and the last actionable request. Keep durable JSONL history
and persisted summary usage/costs.

An illustrative input-only break-even calculation: let the native request have
F tokens, the flattened request S tokens, cached-input price be fraction r of
uncached price, and native hit fraction h. Native input is cheaper when
h > (1 - S/F) / (1-r). At F=250k, S=95k, and r=0.1, the hit rate must exceed
about 69%. At a fully warm cache and illustrative rates of $10/M uncached and
$1/M cached, these inputs cost $0.25 versus $0.95. This excludes new suffix,
output, retries, cache-write charges, and post-compaction warm-up. It is not a
measured saving or a universal pricing claim.

## What Pi sends and keeps

The active path is pi-coding-agent's classic AgentSession, not the separate new
pi-agent-core harness implementation. Source paths below are under node_modules:

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

Pi uses the current session model, not a cheaper dedicated model. The default
request contains a summarization-only system prompt and one user message with
conversation text, optional previous summary, summary-format instructions, and
optional manual focus instructions. It calls the ordinary provider inference API,
not a provider-native compact endpoint. In Codex SSE mode, suppressing the cache
identity also omits session-id/x-client-request-id headers; the fresh SDK UUID
is not a usable cache identity in the resulting request.

It receives an ordinary assistant result, rejects provider errors, incomplete
length-limited responses and tool calls, extracts text, and records usage. A
split turn can require two summarization calls; usage is combined into the single
compaction record. The structured summary includes goals, constraints, progress,
decisions, next steps and critical context, plus file-operation lists.

The checkpoint stores summary, firstKeptEntryId, tokensBefore, details, and usage.
Future requests see the normal system prompt + a synthetic summary user message
+ retained recent messages. Default keepRecentTokens is about 20k; auto-compaction
reserves 16,384 tokens before the model's context limit. The current tail setting
must not be confused with Codex's different retained-message policies.

The computed summary output limit is approximately 80% of reserveTokens, capped
by model.maxTokens. However, this Codex serializer does not emit a max-output
field, so that computed cap is not enforced on this provider path.

Default compaction bypasses before_agent_start and the ordinary context transform.
It also does not receive the normal Agent-level payload/response callbacks;
header hooks still run through the SDK stream wrapper. Therefore ordinary-request
telemetry alone will miss important compaction details. session_before_compact can
supply a replacement checkpoint for both manual and automatic paths without
patching node_modules. At the investigation outset this was the likely, not-yet-implemented integration seam; the implementation sections below record how it was subsequently used and revised.

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

The docs say a warm request reads the existing prefix from cache. A cold request
reprocesses the full history at uncached rates. The exact private summary prompt
and complete CLI wire envelope are not published; the request shape above is
explicitly documented, not reverse-engineered from a closed-source binary.

After compaction, Claude Code replaces old conversation history with the summary,
keeps the system layer, and reloads project context. That context cache-hits only
if the reloaded instructions/memory are unchanged. It rebuilds the shorter
conversation cache on continuation. Caching does not retain omitted context for
the model and does not reduce context-window occupancy.

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

The same requested model does the API summarization. usage.iterations separates
compaction and subsequent message iterations; top-level token counters exclude
compaction iteration usage. A future integration must aggregate correctly without
double-counting message usage. The API recommends a stable system cache breakpoint
and optionally marking the compaction block for subsequent reuse.

## Codex: native compaction, plus a local fallback

Pinned source: [openai/codex 588b781](https://github.com/openai/codex/tree/588b781ab4924ce7352488394028e63d74cf807f).
This describes that source version, not every released CLI or compatible gateway.

### Default remote V2 on supported providers

The remote_compaction_v2 feature is stable and enabled by default in
[features/src/lib.rs:1719–1724](https://github.com/openai/codex/blob/588b781ab4924ce7352488394028e63d74cf807f/codex-rs/features/src/lib.rs#L1719-L1724).
The [request builder](https://github.com/openai/codex/blob/588b781ab4924ce7352488394028e63d74cf807f/codex-rs/core/src/compact_remote_v2_attempt.rs#L67-L110)
retains native history, base instructions and model-visible tools, and appends:

    {"type": "compaction_trigger"}

It streams through the ordinary Responses endpoint, retaining the normal model,
reasoning configuration, and session-derived prompt_cache_key. This trigger is
also specified in the public API reference as an input item that must be last;
it is not merely a private Codex protocol guessed from source.

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

Unsupported providers use ordinary model summarization instead of hosted opaque
compaction. Local means client-orchestrated, not necessarily on-device inference.
The [local compaction source](https://github.com/openai/codex/blob/588b781ab4924ce7352488394028e63d74cf807f/codex-rs/core/src/compact.rs#L248-L400)
appends a user checkpoint prompt, uses current instructions/model/thinking, but
does not populate the normal tool list in that Prompt construction. Therefore
it is not identical to Claude Code's tool-prefix-preserving workflow.

The text response becomes a summary user message. It retains recent real user
messages under an approximately 20k total budget and reinjects canonical initial
context. That is not Pi's 20k recent mixed-role/tool-message tail. Codex persists
replacement history in an append-only rollout checkpoint for resume.

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

At investigation time the guide and API reference disagreed about the maximum
read-breakpoint count (50 versus 80). We should not depend on either number without
confirmation. This does not affect the core prefix-preservation conclusion.

## Historical agreed implementation sequence

User decision: implement Claude-style compaction first. Implement Codex-native
compaction afterward as the intended Codex-provider strategy, not an optional
optimization to consider indefinitely. The user prioritizes Codex native
compaction quality; this is a product requirement, not a measured quality result
from this investigation.

### Phase 1 — Claude-style cache-affine plaintext compaction

Build the portable, prefix-preserving summarization path first. It is not the
final compaction strategy for the Codex provider. Keep provider strategy selection
separate from checkpoint/lifecycle plumbing so the native path can follow without
rewriting the shared machinery.


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

Required integration work includes capability/auth compatibility, correct token
and cost accounting, retained-history reconstruction, cancellation/retry behavior,
and explicit cross-provider resume/model-switch handling. Validate quality and
cost on the actual provider rather than assuming source/API parity. Any interim
plaintext behavior or unsupported-backend fallback must remain distinguishable
from successful native compaction.

At this planning milestone, Phase 2 was deliberately deferred until after Phase 1 but remained required. The later “Phase 2 implemented” section preserves the completed implementation and evidence; this paragraph is not a current status claim.

No production code, provider behavior or installation was changed in this
investigation. External sources were fetched publicly; the serializer experiment
made no model request. Detailed worker notes are in artifacts/compaction/.

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
