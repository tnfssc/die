# Model input source map

Start with [Editing prompts](prompts.md) when reviewing wording. This map explains **what can reach the model, where it comes from, and when it is included**. Linked source files are the canonical wording; the map is not a second copy of every prompt. Runtime templates below explain additional message shapes, not messages guaranteed to appear on every request.

For a concrete first-request view, use `bun run prompt:preview`; options and exclusions are documented in [Inspect the assembled input](prompts.md#inspect-the-assembled-input). This uses the real assembly/hooks with a local fake stream, not a live-provider call.

## Scope and terminology

- **Static source** means repository text authored by die and embedded in the executable.
- **Runtime substitution** is shown as `{{name}}` or described beside a template. Values may be die-generated, runtime metadata, user-supplied, or external content; the distinction is explicit below.
- **External context** is delivered by die or retained by die but is not authored by die. It is not reproduced as though it were an application instruction.
- UI-only command descriptions and notifications that do not enter model context are out of scope. Model-visible custom messages and tool-result advisories are included.

## Production base-prompt and ordinary request composition

Production CLI assembly begins in `src/cli.ts`, which calls `withDieSystemPrompt(cliArgs)` from `src/system-prompt.ts` before entering Pi.

### Base-selection precedence

`withDieSystemPrompt` inserts `--system-prompt <dieSystemPrompt()>` immediately before the CLI's `--` argument boundary, but only when all of these are true:

1. no `--system-prompt` occurs before that boundary;
2. no trusted `<cwd>/.die/SYSTEM.md` exists (an explicit `--no-approve`/`-na` or `projectTrusted: false` makes the project file ineligible); and
3. `<agentDir>/SYSTEM.md` does not exist, where `agentDir` is the explicit option, otherwise `DIE_CODING_AGENT_DIR`, otherwise `~/.die/agent`.

An explicit CLI base, an eligible project SYSTEM.md base, or a global SYSTEM.md base therefore wins and is **externally supplied context**. Arguments after `--` are user prompt arguments, not option candidates. SDK consumers that bypass `src/cli.ts` must supply the base themselves; the CLI injection is the production path.

### Die-owned base assembly recipe

**Sources:** `dieSystemPrompt` in `src/prompts.ts`, `identity.md` and `execute.md`.

The generated base is assembled, in order, as follows:

1. `identity.md`, with its trailing newline removed.
2. The literal scaffold `Guidelines:`.
3. Every complete item from `execute.md`: split only before a line beginning `- `, remove that item's first list marker, then let the base assembly add the marker back. Indented continuation lines therefore remain part of their item.

Components are separated exactly as implemented by `dieSystemPrompt()`: a blank line precedes `Guidelines:`; guideline items are newline-separated. Source trailing newlines are removed before assembly.

There is intentionally no second, documentation-only dump of the assembled base here. The linked `identity.md` and `execute.md` sources plus this recipe give the TypeScript-owned scaffold, so a reader can inspect every die-owned line without maintaining the same prompt twice. Pi receives the result through its structured custom-system-prompt option and may append externally supplied additions, project context/instruction files, skills, current working directory, documentation pointers, and other runtime sections. The base does not copy Pi's upstream default identity or internal-documentation block.

### die hook composition

The effective prompt then passes through `before_agent_start` hooks.

1. **Pi assembly (external dependency):** `@earendil-works/pi-coding-agent@0.85.0` combines the selected base with its dynamic append/project/skill/cwd context and active-tool handling. The exact surrounding rendering is Pi-owned.
2. **Project memory:** within die's extension, `src/memory/extension.ts` registered its hook before the main framing hook. On a root agent it appends the project-memory paragraph shown below. This applies to die's base and to an explicit user-owned custom base.
3. **Collaboration and role/mode:** `src/tasks/extension.ts` classifies custom bases by exact equality of `event.systemPromptOptions.customPrompt` with a fresh `dieSystemPrompt()` result. If a custom base differs, it is user-owned: at root this hook returns without appending collaboration or mode guidance; in a child it appends only the child role. For die's exact base (and the compatibility non-custom case), it appends `system.md`, then either a root main-mode block or child role block, separated by blank lines.
4. **Other extensions:** hooks registered outside die may add framing before or after it. `src/tasks/instruction-continuity.ts` pins the final prepared frame through tool continuations and fresh compaction; it adds no prose.

The ordinary production prompt is therefore:

```text
[dieSystemPrompt() assembled by the recipe above]
[Pi-owned dynamic append/project/skill/cwd context]

[project-memory paragraph, root only]

[system.md]

[root main-mode block OR child role block]
```

For an externally supplied custom base, root collaboration/mode text is deliberately suppressed. Child sessions still receive their role prose, without delegation commentary. Runtime delegation restrictions are enforced independently by the job service.

### Root mode selection

`src/tasks/instruction-mode.ts` defaults root sessions to `orchestrator`, restores the newest valid `die-instruction-mode` branch entry, and falls back to `orchestrator` on absent or invalid state. Orchestrator selects `main-orchestrator.md`; fast and normal select no mode-specific prose. Every selection retains an owned placeholder wrapped as:

```text
<!-- die:main-agent-mode:{{owner}}:start -->
{{orchestrator Markdown with trailing newline removed, or empty for fast/normal}}
<!-- die:main-agent-mode:{{owner}}:end -->
```

`{{owner}}` is the SHA-256 hex digest of `"die-main-agent-mode\0" + sessionId`; it is internally generated, not user/project text. `/mode` replaces only the region with this exact owner marker. Root user-owned custom system prompts receive no mode block.

### Child role selection

For depth greater than zero, `subagentGuidance(role)` selects `fast.md`, `normal.md`, or `orchestrator.md` (unknown roles fall back to normal) and substitutes the runtime role string. No child receives a delegation-guidance fragment. The job service still enforces delegation permissions independently. Child identity/depth comes from process environment plus the newest valid `die-agent` session marker and fails closed. The user's subagent assignment itself is passed as the child's ordinary user prompt and is **external caller-supplied context**, not part of these role templates.

## Execute tool assembly

`src/typescript/extension.ts` registers one provider-visible tool:

- name: `execute`
- prompt snippet: `Run JS/TS.`
- provider tool description: full `execute-description.md` text (trailing newline removed)
- prompt guidelines: `execute.md` split at each line beginning `- `; each list marker is removed because Pi adds list formatting back
- input schema: object with required string `code`; optional numeric `timeoutSeconds`, minimum 0.1

Pi owns the exact surrounding system-prompt rendering of the snippet/guidelines and provider tool-schema serialization. At session start die calls `pi.setActiveTools(["execute"])`, so other Pi tools are not active. The helper names `shell`, `subagent`, `jobs.*`, `history.*`, `goal.*`, and `handoff` are runtime globals inside execute rather than separate provider tools; their model guidance is in the linked `execute.md` source. `system.md` contains collaboration values and opinions.

## Static Markdown sources

All files below are embedded at build time. Only the sources selected by the current request are included; the model does not lazy-load them itself.

| Source | Where / when supplied |
| --- | --- |
| [identity.md](../src/prompts/identity.md) | Default base system instructions. |
| [execute.md](../src/prompts/execute.md) | Default base API guidance; also registered as the execute tool's prompt guidelines. Pi owns rendering for custom bases. |
| [execute-description.md](../src/prompts/execute-description.md) | Provider-visible execute tool description, not a separate chat message. |
| [system.md](../src/prompts/system.md) | Collaboration values/opinions added by the framing hook, except for user-owned custom bases. |
| [memory.md](../src/prompts/memory.md) | Root memory guidance, including roots using custom bases. Does not read the note corpus. |
| [memory-consolidation.md](../src/prompts/memory-consolidation.md) | Ordinary user prompt for an explicitly launched memory-consolidation worker; runtime values are interpolated at launch. |
| [main-orchestrator.md](../src/prompts/main-orchestrator.md) | Root orchestrator guidance. Fast/normal retain only the owned empty mode placeholder; all root mode blocks are suppressed for user-owned custom bases. |
| [fast.md](../src/prompts/fast.md), [normal.md](../src/prompts/normal.md), [orchestrator.md](../src/prompts/orchestrator.md) | Exactly one child role, including children with custom bases. Assignment is a separate user message. |
| [background-handoff.md](../src/prompts/background-handoff.md) | Added to an execute result that reports background launches; job IDs substituted. Not in the initial base. |
| [goal.md](../src/prompts/goal.md) | Goal API guidance included with the goal-state context message only when a goal exists; not in the system prefix. |
| [goal-continuation.md](../src/prompts/goal-continuation.md) | Automatic user message when an active durable goal needs another turn. Goal state arrives separately. |
| [compaction.md](../src/prompts/compaction.md) | Final user instruction for plaintext compaction, not ordinary work. |
| [compaction-jobs.md](../src/prompts/compaction-jobs.md) | Running-job snapshot attached to a saved checkpoint when jobs exist. |
| [native-compaction.md](../src/prompts/native-compaction.md) | Native checkpoint label; not a text summarization request. The provider receives a compaction trigger. |

## Dynamic model-facing additions and templates

These enter the message history or instruction frame only in their listed situations. A first-turn preview cannot demonstrate a later completion or compaction; inspect that scenario or its producer rather than assume all templates are always present.

### Project-memory system paragraph

**Source:** `src/prompts/memory.md`, embedded and appended by `src/memory/extension.ts`.
**Condition:** appended on every `before_agent_start` only when `isRoot()` returns true, including custom bases. See the linked Markdown source above; paths are literal relative paths.

### Memory-consolidation worker prompt

**Source:** [`src/prompts/memory-consolidation.md`](../src/prompts/memory-consolidation.md), embedded and rendered by `workerPrompt` in `src/memory/extension.ts`.
**Condition:** created only by `/memory consolidate fast|normal --constraints ...` on a root agent with pending notes. It is sent as the spawned worker's ordinary user prompt.

The linked Markdown file is the canonical and complete static worker prose; it is not duplicated here. Rendering replaces `{{constraints}}`, `{{paths}}`, `{{cwd}}`, and `{{receipt}}` in one callback-based pass, so placeholder-like text and dollar sequences inside inserted values remain literal.

Dynamic values: `{{constraints}}` is the preserved user command text; `{{paths}}` is `- <path>` for each note in the launch snapshot (or `- (none)`); `{{cwd}}` is the resolved runtime working directory; and `{{receipt}}` is the internally generated absolute nonce path. After a successful worker exit, die validates the existing receipt contract and saved-file hashes before marking the launch snapshot consumed.

### Persistent goal state

**Sources:** `src/goals/extension.ts`, `src/prompts/goal.md`, `src/prompts/goal-continuation.md`
When a goal exists, every context preparation appends a hidden custom message containing the goal guidance and current state after the messages received by that hook. This applies to every goal status, not just `active`. No goal means no injected guidance/state message. The state portion is:

```text
Persistent goal state (authoritative):
Goal: {{objective}}
Status: {{status}}
Criteria: {{criteria joined with "; "}}
Constraints: {{constraints joined with "; ", or "none"}}
{{optional Progress block, one "- item" per stored milestone}}
{{optional Evidence: ...}}
{{optional Blocker: ...}}
{{optional Waiting on: IDs joined with ", "}}
{{optional Reason: ...}}
```

The same message includes the static API guidance from `goal.md`. Activating, updating, or clearing a goal changes message context, not the system prompt or tool definitions, preserving the reusable system prefix. This is not a guarantee of a provider cache hit.

Field values are persisted runtime goal state supplied by the user, model helper calls, or runtime-owned job reconciliation; they are **dynamic/external state**, not static die prose. The message has role `custom`, custom type `die-goal-state`, is hidden from display, and receives the current timestamp.

The automatic follow-up is the complete, unsubstituted `goal-continuation.md` source followed by internal generation and anti-replay markers:

```text
<!-- die-goal-generation:{{generation}} -->

<!-- die-goal-reminder:{{random UUID epoch}}:{{generation}}:{{sequence}} -->
```

The authoritative objective, criteria, constraints, status, and progress are deliberately present only in the hidden goal-state message above; the continuation does not repeat them. Die sends this extension-originated follow-up user message immediately after `/goal set` or `/goal resume`, and after a fully settled run only when the current goal status is `active` and the continuation controller returns `continue`. A helper-created active goal is picked up at that settled boundary. A waiting goal can become active when owned work finishes and is then eligible at settlement. Paused, waiting, blocked, and completed goals do not schedule continuation messages. After three automatic runs without a newly recorded progress milestone, the controller pauses the goal instead of continuing. Generation/epoch/sequence checks reject stale or replayed reminders.

### Background launch and explicit handoff

**Sources:** `src/prompts/background-handoff.md`, `src/prompts.ts`, `src/typescript/extension.ts`  
If an execute invocation receives one or more background results from `shell` or `subagent`, `{{jobs}}` is replaced by at most the first 20 runtime job IDs, comma-space separated. More IDs add ` (and N more)`. The resulting full Markdown source is appended to the execute tool result.

If `await handoff(message)` succeeds, the result begins:

```text
Execution handed off.

{{message}}
```

`{{message}}` is model-authored execute input (runtime content), limited to 2,000 characters. Existing stdout/stderr/images and the background notice follow only when present; the successful tool result requests turn termination.

### Completion and attention steering messages

**Sources:** `src/tasks/completion-notification.ts`, `src/tasks/job-attention.ts`, batching in `src/tasks/extension.ts`  
These are model-visible custom messages delivered as `steer` with `triggerTurn: true`. Runtime job IDs, commands, paths, status, output, durations, and counts are external/runtime content. Completion messages are bounded to 5,000 characters (2,499 when mixed with attention); attention messages are bounded to 5,000 characters (the remaining mixed budget).

For batches of at most 10 completions:

```text
{{count}} asynchronous task{{s}} completed.

{{id}} {{status}}
Command: {{bounded command preview}}
{{optional Exit code: N}}
{{optional Signal: signal}}
{{optional Timed out: yes}}
{{optional Session: bounded child session path}}
{{if output: "Final output preview:" or, for a failed child, "Diagnostic preview (last progress, not a final answer):"}}
{{tail output, max 1,000 chars}}
{{or: No output.}}
```

When space runs out, the omitted block is:

```text
{{count}} additional completion{{s}} omitted from this notification.
IDs: {{IDs, possibly "… (+N more)"}}
```

For more than 10 completions:

```text
{{count}} asynchronous tasks completed.

Result previews:
{{up to 5 lines: id status [exit=N|signal=...] [— whitespace-collapsed output tail]}}

{{omitted block above}}
```

Attention template:

```text
{{count}} running job{{s}} reached an attention checkpoint. Jobs continue running.

{{id}} [{{quiet+review reasons}}] elapsed={{duration}} quiet={{duration}} output={{bytes}}B stdin={{open|closed}}
{{Recent output: whitespace-collapsed tail up to 500 chars | No retained output observed.}}

{{optional omitted checkpoints and IDs}}
```

### Execute-result advisories

**Sources:** `src/typescript/execution.ts`, `src/typescript/extension.ts`. These are conditional parts of the provider-visible tool result:

- On long text output, the result includes a truncated preview and paths to full stdout/stderr files. The total preview threshold is 4,000 characters. Short output remains inline with no log files. Exact formatting and file-write errors come from `src/typescript/execution.ts`; shell-job retention is unchanged.

- With no output:

```text
No output.
```

- If images were emitted but the current model lacks image input:

```text
This model can't take images. Images not sent.
```

Execution status, stdout/stderr, errors, and image counts are runtime evidence, not authored instructions.

## Compaction assembly

### Cache-affine plaintext compaction

**Source:** `src/tasks/cache-affine-compaction.ts`, `src/prompts/compaction.md`, and `compaction-jobs.md`.
On `session_before_compact`, when native Codex compaction does not own the event and identity/capacity/safety checks pass:

1. Pi prepares the **entire current** conversation through ordinary context transforms. Its final current system prompt and active provider tool definitions are reused unchanged.
2. Die fills the custom-focus sentence in `compaction.md` and appends the result as a final **user** message after that complete prepared model-facing history.
3. It invokes the same captured model/provider and thinking setup with a bounded output allowance. Provider request/header hooks still run.
4. A usable text-only response becomes the durable summary. Pi's unchanged `firstKeptEntryId` then replays its existing recent tail after the checkpoint, deliberately overlapping the whole-conversation summary. If jobs are running, the filled `compaction-jobs.md` block is appended deterministically after the provider's summary.

Runtime fields:

- If `event.customInstructions.trim()` is nonempty, `customInstructions` becomes `Additional user focus: {{verbatim trimmed external custom instructions}}`; otherwise no focus footer is added. Literal insertion does not run template replacement over the focus text.
- In `compaction-jobs.md`, `jobs` is one line per currently running job: `- {{id}}: {{kind}}, {{status}}`.
- Conversation messages, tool outputs, custom compaction instructions, and the generated summary are external/runtime model content, not die static prose.

### Native Codex compaction and replay

**Source:** `src/tasks/native-compaction.ts`, `src/prompts/native-compaction.md`, and `compaction-jobs.md`.  
For `openai-codex-responses` with a fresh compatible captured request and no custom compaction instructions, die does **not** send a textual summarization prompt. It clones the final captured provider payload, changes `service_tier` to `default`, and appends this provider-native item to `input`:

```json
{ "type": "compaction_trigger" }
```

Every other captured payload field is retained. Headers are rebuilt from model headers, auth headers, and captured headers (later sources overwrite earlier ones); OAuth authorization/account headers are required. Transport-only `host`, `content-length`, connection/WebSocket headers are removed, and die sets the originator, user agent, SSE accept, JSON content type, experimental beta, session ID/cache key, and request ID. Provider endpoint/auth/stream parsing are assembled in `native-compaction.ts`. The provider returns an opaque `{type:"compaction", id, encrypted_content}` item. Die stores that opaque item in checkpoint details and uses the full `native-compaction.md` text only as the stored/displayed checkpoint summary label. During normal native replay, the context adapter replaces that summary message with the opaque item; the label itself is not sent as a model instruction. The encrypted content is provider output, never interpolated as prompt text.

If jobs are running, die fills `compaction-jobs.md` and stores it as `runtimeState`. On replay, the opaque item is carried as an assistant thinking signature; runtime state is then inserted as a separate **user** message. Native custom instructions force plaintext fallback when safe, or cancellation when an existing opaque checkpoint could not be rewritten safely.

## Provider boundary

For an ordinary request, die hands Pi's agent runtime the final `systemPrompt`, transformed messages, and the active `execute` tool definition. Provider-specific wire assembly belongs to `@earendil-works/pi-ai@0.85.0`, not to an application-owned prompt source. The repository's deterministic Codex test (`tests/provider-prompt.test.ts`) verifies that the complete supplied system prompt is serialized unchanged as the Codex Responses `instructions` field and that `tool_choice` is `auto`.

Die's provider hooks do not otherwise add instructions: cache countdown/native-fast alter metadata or headers, native compaction adds only the provider trigger above, and cache-affine compaction deliberately reuses current system/tools while adding its user message. `before_provider_request` capture in compaction code observes payloads; it is not another prompt layer.

## Externally supplied or generated context (not die instructions)

The following may be model-facing but must not be mistaken for static application instructions:

- explicit user system prompts and ordinary user messages;
- Pi's default base prose, exact tool-section formatting, and generated Pi documentation paths/guidance;
- appended system prompt options, `AGENTS.md`/project instruction files, skills, prompt templates, current working directory, model/provider metadata, and third-party extension additions;
- subagent assignment prompts supplied by the parent (except the die-built memory worker template documented above);
- persisted goal field values and user custom-compaction focus;
- retrieved history text and provenance returned by `history.*`;
- shell output, child-agent progress/final output, job commands/IDs/session paths, tool errors, and user-provided stdin;
- provider-generated plaintext summaries and opaque encrypted compaction items.

This separation keeps static die prose distinct from dynamic values and externally supplied or generated content.
