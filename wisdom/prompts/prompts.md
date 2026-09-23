# Editing prompts

Changing what model gets? Start here. Talk that led to a line may be gone. This guide and record should still explain the work.

## Start with the whole input

One prompt file is not whole input. Read built system instructions, tool definitions, and messages before saying an explanation is missing. Earlier text may explain a line. Some text comes only after a tool call. Can inspect what model gets. Need behavior tests to know what it understands.

- [Source map](./system-instructions.md): sources, order, conditions, custom-prompt precedence, and runtime messages.
- [Project wisdom history](../wisdom-system/project-history.md): recent decisions and the point where a review stopped.
- [Historical validation](./prompt-validation-history.md): prior experiments and failures, not today's recommended wording.
- Canonical wording lives in `src/prompts/*.md`, not in copied documentation or an installed older binary.

## Inspect the assembled input

Run from the checkout, without credentials or a model request:

```sh
bun run prompt:preview
bun run prompt:preview -- --project .
bun run prompt:preview -- --mode fast
bun run prompt:preview -- --role normal
bun run prompt:preview -- --goal "Representative objective"
```

Command prints JSON with `systemPrompt`, `tools`, `messages`, and metadata about what it included or left out. Use `--message` for user message. Default mode is root orchestrator. `--role` picks depth-one child. `--mode` works only for roots.

This runs real Pi session assembly and die extension hooks. It captures context at provider-stream boundary with fake local response. It does not join a guessed prompt by hand. It uses temporary agent directory and in-memory session, then cleans both up. It does not run model tools or launch jobs.

Default is isolated: no project instruction files. `--project` includes instruction files Pi finds for project and ancestors (AGENTS.md and supported alternatives). It also includes `.die/SYSTEM.md` and `.die/APPEND_SYSTEM.md` when present. This opts into those prompt files. It does not replay saved project trust settings. It leaves out global configuration, project settings/packages, extensions, skills, themes, and templates. Read metadata before treating result as match for your case.

`--goal` puts sample **paused** goal and API guidance through real goal-state context hook. It does not start automatic goal work. First-request preview does not make live completion/attention messages, tool-result handoffs, prior conversation, or compaction. See their conditions/producers in [source map](./system-instructions.md). Preview uses fixed Codex model identity for assembly. It does not use user's chosen live provider or wire transport. It shows input, not proof model understood or acted well.

For delivery and offline-preview checks:

```sh
bun test tests/prompt-preview.test.ts tests/prompt-delivery.test.ts tests/provider-prompt.test.ts
bun run check
```

## A useful review cycle

First learn what happens today. Then talk about change. Asked about current behavior? Do not invent new wording.

Read relevant built input and source. Ask what section adds: missing fact, useful value, distinction, or repeat? Explain gap before replacement. User questions it? Check evidence again. Do not flip answer or make new slogan by reflex.

In line-by-line review, offer one clear change. Leave room to talk. After approval, save it and read in context. Record reason and next review point. API facts must match code. Assembly checks must show intended text reaches model. They do not prove model follows it.

This helps reason together. It is not script for every edit. Keep small change small.

## What belongs where

| Kind | Home | Purpose |
| --- | --- | --- |
| Values and opinions | `src/prompts/system.md` | Help the agent exercise judgment; opinions state chosen defaults. |
| Identity | `src/prompts/identity.md` | Explain its job and name the environment. |
| Tool facts | `src/prompts/execute.md` and `execute-description.md` | Signatures, defaults, results, and what calling a function does. |
| Conditional guidance | Role/mode, wisdom, handoff, goal, and compaction sources | Information needed in that particular situation. See the source map. |
| Assembly | TypeScript consumers | Select and combine text. Static prose belongs in Markdown rather than hidden literals. |
| Decisions and review position | Project wisdom | Preserve reasons, unresolved questions, and where to resume—not the full transcript. |

Rewrite behavior, not only words. Swapping formal labels for simple synonyms is not enough. Say what agent should do. Keep purpose. Keep short. Do not turn small instruction into checklist.

Use plain words in model-facing prose. User wants caveman-style wording and straight quotes. Keep exact API names/types exact. General advice can state value. New tone does not make random workflow rule a value.

## Decisions worth remembering

These sum up user decisions from September 12–13 review. Reasons let next reviewer think again. No keep or delete lines by reflex.

| Decision | Reason / rejected alternative |
| --- | --- |
| Teach judgment, not a growing rulebook. | Guidance should help unfamiliar cases. The goal is useful work, not bulletproof compliance. |
| Merge the original responsiveness and attention values. | Both arose from wasting turns: breaking up nearly finished work, or holding a turn open to wait/poll. Their separate names were an assistant's categorization, not two user requirements. |
| Encourage following clues beyond the first source. | Git explained edits but not why the user requested them; prior sessions supplied that context. Do not confuse an honest partial search with answering the question. |
| Favor fewer parts and less maintained state. | Database, Redis, and client state all add things to keep consistent. Simplicity is not an instruction to do a smaller job than requested. |
| Assume greenfield unless compatibility is requested. | Existing code is not itself a requirement to preserve old behavior; restarting is allowed when useful. |
| Remove "do next useful bit, not whole job at once". | It imposes an arbitrary execution size. Completing a whole task in one execution may be the simplest choice. |
| Remove hardcoded concision/path directives from TypeScript. | The user did not want those extra directives; prose should not be hidden in assembly code. |
| Keep `/mode`, but remove fast/normal root guidance and disabled-delegation prose without replacements. | Fast and normal roots now add no mode-specific behavioral prose. Runtime delegation policy and durable mode switching are separate and remain enforced. |
| Explain handoff directly, without the worked example or parallel-call caveat in that paragraph. | Those additions obscured the basic operation. Exact parallel semantics still exist in runtime documentation/tests. |
| Explain attention as distinct from completion, without re-explaining turns from scratch. | Earlier launch-result and handoff text already explains being resumed. The remaining gap is being resumed while work is still running. Final Job API wording is still under review. |
| Keep goal guidance conditional and outside the system prefix. | Ordinary chat does not need goal API prose. When a goal exists, supply guidance with its context message (also for waiting/blocked/paused/completed); activation must not change the cached system prefix. |
| Maintain wisdom as work evolves. | Location facts alone did not convey the purpose of saving decisions for the next agent. |

[the review wisdom](./prompt-review-2026-09-12.md) has session paths and stdin evidence. This summary still works if sessions go away.

## Keeping this useful

Assembly or inclusion conditions changed? Update source map. Keep links and explanations there, not hand-kept copy of all prompts. Update decision wisdom when reason changes or review stops.

Report edits, tests, and install separately. Build embeds Markdown. Source edit does not change running binary. Real-model experiments need explicit cost-aware approval. Normal inspection and assembly tests stay offline.

## Same voice for prompts and wisdom (2026-09-23)

User caught formal policy talk in the new values prompt and wisdom. Meaning was not enough. Wording must fit rest of project too. Short words. Short sentences. Plain talk. Read nearby text before writing. Keep exact names and facts where needed. This applies to wisdom as well as prompts.

PR #2 wording fixed. Parent changed prompt, values, and tests. Worker rewrote four wisdom-system files in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6910c481, branch die/rewrite-new-wisdom-in-project-voice-6910c481 (task_6910c481). Worker commit 77ab851 brought into feat/derived-wisdom-values as f2d63a8. Parent checked the pieces and links. All 30 prompt, SDK, preview, delivery, and provider tests pass. Push same PR. No new value needed; this sharpens how we write the existing ones.
