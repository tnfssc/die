# Model input source map

Read [Editing prompts](./prompts.md) before wording review. This map shows **what can reach model, where it comes from, and when it appears**. Linked files own wording. Map does not copy every prompt. Runtime templates below show other message shapes. They do not come on every request.

Run `bun run prompt:preview` to see real first-request build. [Inspect the assembled input](./prompts.md#inspect-the-assembled-input) gives options and limits. Preview uses real assembly and hooks with fake local stream. It does not call live provider.

## Scope and terminology

- **Static source** means repository text authored by die and embedded in the executable.
- **Runtime substitution** is shown as `{{name}}` or described beside a template. Values may be die-generated, runtime metadata, user-supplied, or external content; the distinction is explicit below.
- **External context** is delivered by die or retained by die but is not authored by die. It is not reproduced as though it were an application instruction.
- UI-only command descriptions and notifications that do not enter model context are out of scope. Model-visible custom messages and tool-result advisories are included.

## Production base-prompt and ordinary request composition

Production CLI build starts in `src/cli.ts`. It calls `withDieSystemPrompt(cliArgs)` from `src/system-prompt.ts` before Pi.

### Base-selection precedence

`withDieSystemPrompt` inserts `--system-prompt <dieSystemPrompt()>` immediately before the CLI's `--` argument boundary, but only when all of these are true:

1. no `--system-prompt` occurs before that boundary;
2. no trusted `<cwd>/.die/SYSTEM.md` exists (an explicit `--no-approve`/`-na` or `projectTrusted: false` makes the project file ineligible); and
3. `<agentDir>/SYSTEM.md` does not exist, where `agentDir` is the explicit option, otherwise `DIE_CODING_AGENT_DIR`, otherwise `~/.die/agent`.

Explicit CLI base, eligible project SYSTEM.md base, or global SYSTEM.md base wins. It is **externally supplied context**. Arguments after `--` are user prompt, not option candidates. SDK users that skip `src/cli.ts` must give base themselves. CLI injection is production path.

### Die-owned base assembly recipe

**Sources:** `dieSystemPrompt` in `src/prompts.ts`, `identity.md` and `execute.md`.

The generated base is assembled, in order, as follows:

1. `identity.md`, with its trailing newline removed.
2. The literal scaffold `Guidelines:`.
3. Every complete item from `execute.md`: split only before a line beginning `- `, remove that item's first list marker, then let the base assembly add the marker back. Indented continuation lines therefore remain part of their item.

`dieSystemPrompt()` separates parts exactly this way: blank line before `Guidelines:`; newline between guideline items. Build removes source trailing newlines first.

No second docs-only dump of built base here. Linked `identity.md` and `execute.md` plus recipe show TypeScript-owned scaffold. Reader can inspect every die-owned line without keeping duplicate prompt. Pi gets result through structured custom-system-prompt option. Pi may append outside additions, project context/instruction files, skills, current working directory, docs pointers, and other runtime sections. Base does not copy Pi upstream default identity or internal-docs block.

### die hook composition

The effective prompt then passes through `before_agent_start` hooks.

1. **Pi assembly (external dependency):** `@earendil-works/pi-coding-agent@0.85.0` combines the selected base with its dynamic append/project/skill/cwd context and active-tool handling. The exact surrounding rendering is Pi-owned.
2. **Project wisdom:** within die's extension, `src/wisdom/extension.ts` registers its hook before the main framing hook. On a root agent it appends the project-wisdom paragraph shown below. This applies to die's base and to an explicit user-owned custom base.
3. **Collaboration and role/mode:** `src/tasks/extension.ts` classifies custom bases by exact equality of `event.systemPromptOptions.customPrompt` with a fresh `dieSystemPrompt()` result. If a custom base differs, it is user-owned: at root this hook returns without appending collaboration or mode guidance; in a child it appends only the child role. For die's exact base (and the compatibility non-custom case), it appends `system.md`, then either a root main-mode block or child role block, separated by blank lines.
4. **Other extensions:** hooks registered outside die may add framing before or after it. `src/tasks/instruction-continuity.ts` pins the final prepared frame through tool continuations and fresh compaction; it adds no prose.

The ordinary production prompt is therefore:

```text
[dieSystemPrompt() assembled by the recipe above]
[Pi-owned dynamic append/project/skill/cwd context]

[project-wisdom paragraph, root only]

[system.md]

[root main-mode block OR child role block]
```

Outside custom base suppresses root collaboration/mode text on purpose. Child still gets role prose. Only orchestrator roles add workspace-isolation judgment. Job service enforces runtime delegation limits separately. Execute reference documents optional `title`, structured `workspace` choice (inherit by default), batch isolation, and mode-specific setup sources. Only two orchestrator role sources say when to pick isolated code/PR work versus shared research/edits. Workspace choice does not change custom-base or role inheritance.

### Root mode selection

`src/tasks/instruction-mode.ts` starts root in `orchestrator`. It restores newest valid `die-instruction-mode` branch entry. Missing or bad state falls back to `orchestrator`. Orchestrator picks `main-orchestrator.md`. Fast and normal pick no mode prose. Every choice keeps owned placeholder wrapped as:

```text
<!-- die:main-agent-mode:{{owner}}:start -->
{{orchestrator Markdown with trailing newline removed, or empty for fast/normal}}
<!-- die:main-agent-mode:{{owner}}:end -->
```

`{{owner}}` is SHA-256 hex of `"die-main-agent-mode\0" + sessionId`. Code makes it. User/project text does not. `/mode` replaces only region with this exact owner marker. Root custom system prompts owned by user get no mode block.

### Child role selection

At depth over zero, `subagentGuidance(role)` picks `fast.md`, `normal.md`, or `orchestrator.md`. Unknown role falls back to normal. It puts runtime role string in template. No child gets delegation-guidance fragment. Job service still enforces delegation powers. Child identity/depth comes from process environment and newest valid `die-agent` session marker. Bad state fails closed. User subagent assignment is child normal user prompt. It is **external caller-supplied context**, not role template.

## Execute tool assembly

`src/typescript/extension.ts` registers one provider-visible tool:

- name: `execute`
- prompt snippet: `Run JS/TS.`
- provider tool description: full `execute-description.md` text (trailing newline removed)
- prompt guidelines: `execute.md` split at each line beginning `- `; each list marker is removed because Pi adds list formatting back
- input schema: object with required string `code`; optional numeric `timeoutSeconds`, minimum 0.1

Pi owns exact system-prompt rendering around snippet/guidelines and provider tool-schema encoding. At session start die calls `pi.setActiveTools(["execute"])`. Other Pi tools are inactive. Helpers `shell`, `subagent`, `jobs.*`, `history.*`, `goal.*`, and `handoff` are execute globals, not separate provider tools. Linked `execute.md` gives model guidance. `system.md` has collaboration values and opinions.

## Static Markdown sources

Build embeds all files below. Current request picks sources. Model does not lazy-load them.

| Source | Where / when supplied |
| --- | --- |
| [identity.md](../../src/prompts/identity.md) | Default base system instructions. |
| [execute.md](../../src/prompts/execute.md) | Default base API guidance; also registered as the execute tool's prompt guidelines. Pi owns rendering for custom bases. |
| [execute-description.md](../../src/prompts/execute-description.md) | Provider-visible execute tool description, not a separate chat message. |
| [system.md](../../src/prompts/system.md) | Collaboration values/opinions added by the framing hook, except for user-owned custom bases. |
| [wisdom.md](../../src/prompts/wisdom.md) | Root wisdom guidance, including roots using custom bases. Does not read the wisdom corpus. |
| [main-orchestrator.md](../../src/prompts/main-orchestrator.md) | Root orchestrator guidance. Fast/normal retain only the owned empty mode placeholder; all root mode blocks are suppressed for user-owned custom bases. |
| [fast.md](../../src/prompts/fast.md), [normal.md](../../src/prompts/normal.md), [orchestrator.md](../../src/prompts/orchestrator.md) | Exactly one child role, including children with custom bases. Assignment is a separate user message. |
| [background-handoff.md](../../src/prompts/background-handoff.md) | Added to an execute result that reports background launches; job IDs substituted. Not in the initial base. |
| [goal.md](../../src/prompts/goal.md) | Goal API guidance included with the goal-state context message only when a goal exists; not in the system prefix. |
| [goal-continuation.md](../../src/prompts/goal-continuation.md) | Automatic user message when an active durable goal needs another turn. Goal state arrives separately. |
| [compaction.md](../../src/prompts/compaction.md) | Final user instruction for plaintext compaction, not ordinary work. |
| [compaction-jobs.md](../../src/prompts/compaction-jobs.md) | Running-job snapshot attached to a saved checkpoint when jobs exist. |
| [native-compaction.md](../../src/prompts/native-compaction.md) | Native checkpoint label; not a text summarization request. The provider receives a compaction trigger. |

## Dynamic model-facing additions and templates

These enter message history or instruction frame only in listed cases. First-turn preview cannot show later completion or compaction. Inspect that case or producer. Do not assume all templates always come.

### Project-wisdom system paragraph

**Source:** `src/prompts/wisdom.md`, embedded and appended by `src/wisdom/extension.ts`.
**Condition:** appended on every `before_agent_start` only when `isRoot()` returns true, including custom bases. See the linked Markdown source above; paths are literal relative paths.

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

Same message includes static API guidance from `goal.md`. Starting, updating, or clearing goal changes message context. It does not change system prompt or tools. This keeps reusable system prefix. It does not promise provider cache hit.

Field values are saved runtime goal state. They come from user, model helper calls, or runtime job reconciliation. They are **dynamic/external state**, not static die prose. Message role is `custom`, custom type is `die-goal-state`, display hides it, and it gets current timestamp.

The automatic follow-up is the complete, unsubstituted `goal-continuation.md` source followed by internal generation and anti-replay markers:

```text
<!-- die-goal-generation:{{generation}} -->

<!-- die-goal-reminder:{{random UUID epoch}}:{{generation}}:{{sequence}} -->
```

Only hidden goal-state message above has full objective, criteria, constraints, status, and progress. Continuation does not repeat them. Die sends this extension follow-up right after `/goal set` or `/goal resume`. After settled run, it sends only when goal is `active` and controller says `continue`. Helper-created active goal is found at settled boundary. Waiting goal may turn active when owned work ends, then qualify at settlement. Paused, waiting, blocked, and completed goals schedule no continuation. Three automatic runs with no new progress milestone pause goal. Generation/epoch/sequence checks reject stale or replayed reminders.

### Background launch and explicit handoff

**Sources:** `src/prompts/background-handoff.md`, `src/prompts.ts`, `src/typescript/extension.ts`  
If an execute invocation receives one or more background results from `shell` or `subagent`, `{{jobs}}` is replaced by at most the first 20 runtime job IDs, comma-space separated. More IDs add ` (and N more)`. The resulting full Markdown source is appended to the execute tool result.

If `await handoff(message)` succeeds, the result begins:

```text
Execution handed off.

{{message}}
```

`{{message}}` is model-written execute input, limited to 2,000 characters. Existing stdout/stderr/images and background notice follow only when present. Successful tool result asks turn to end.

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

Execution status, stdout/stderr, errors, and image counts are runtime facts. They are not written instructions.

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

Keep every other captured payload field. Rebuild headers from model, auth, and captured headers. Later source wins. OAuth authorization/account headers are required. Remove transport-only `host`, `content-length`, connection/WebSocket headers. Die sets originator, user agent, SSE accept, JSON content type, experimental beta, session ID/cache key, and request ID. `native-compaction.ts` builds provider endpoint/auth/stream parsing. Provider returns opaque `{type:"compaction", id, encrypted_content}` item. Die stores opaque item in checkpoint details. Full `native-compaction.md` text is only stored/displayed checkpoint summary label. During normal native replay, context adapter swaps summary message for opaque item. Label is not sent as model instruction. Encrypted content is provider output. Never put it into prompt text.

Jobs running? Die fills `compaction-jobs.md` and stores as `runtimeState`. On replay, opaque item travels as assistant thinking signature. Runtime state then enters as separate **user** message. Native custom instructions force plaintext fallback when safe. They cancel when existing opaque checkpoint cannot be safely rewritten.

## Provider boundary

For normal request, die gives Pi agent runtime final `systemPrompt`, changed messages, and active `execute` tool definition. `@earendil-works/pi-ai@0.85.0` owns provider wire build. No app prompt source owns it. Deterministic Codex test `tests/provider-prompt.test.ts` checks full supplied system prompt reaches Codex Responses `instructions` unchanged and `tool_choice` is `auto`.

Other die provider hooks add no instructions. Cache countdown/native-fast change metadata or headers. Native compaction adds only provider trigger above. Cache-affine compaction reuses current system/tools and adds its user message. `before_provider_request` capture in compaction code watches payloads. It is not another prompt layer.

## Externally supplied or generated context (not die instructions)

Following may face model. They are not static app instructions:

- explicit user system prompts and ordinary user messages;
- Pi's default base prose, exact tool-section formatting, and generated Pi documentation paths/guidance;
- appended system prompt options, `AGENTS.md`/project instruction files, skills, prompt templates, current working directory, model/provider metadata, and third-party extension additions;
- subagent assignment prompts supplied by the parent (except the die-built memory worker template documented above);
- persisted goal field values and user custom-compaction focus;
- retrieved history text and provenance returned by `history.*`;
- shell output, child-agent progress/final output, job commands/IDs/session paths, tool errors, and user-provided stdin;
- provider-generated plaintext summaries and opaque encrypted compaction items.

This keeps static die prose apart from dynamic values and outside or generated content.
