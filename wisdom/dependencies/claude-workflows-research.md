# Claude Dynamic Workflows research

Research ran on 2026-09-06 with tvly advanced search and extraction. It was checked against the official workflows Markdown page. The tvly research endpoint needed an API key and was not available. This is primary-source research, not a finished Tavily Research API report. Source snapshots remain under ignored `artifacts/research/`.

## Correction to the earlier answer

Claude Code has a real Dynamic Workflows feature and a Workflow tool. This is not just the older Building Effective Agents pattern list, normal subagent delegation, skills, or agent teams. A background runtime runs an orchestration script. Intermediate results stay outside the lead model's context.

## Execution model

1. Claude writes JavaScript that starts with a literal `export const meta`. It contains a name and description, and can also contain phases.
2. `Workflow` accepts `script`, `name`, or `scriptPath`, plus JSON args and optional `resumeFromRunId`. `scriptPath` wins when present. The TypeScript Agent SDK documents this from v0.3.149.
3. The runtime saves the script under the session directory and runs it in an isolated background environment.
4. `agent(prompt, options)` runs a full subagent, not one inference. The cookbook shows a clean task context and options for model, schema, label, and phase.
5. `parallel` waits for all results. `pipeline` moves each item through stages on its own, so stages can overlap across items. `phase` and `log` add progress data.
6. Script variables hold intermediate results. Only the combined result returns to the lead conversation. SDK users must tell the launch-turn `ResultMessage` from final completion. They can also watch task progress and notifications.
7. Scripts saved in project or user `.claude/workflows` directories become named commands. This is saved orchestration code, not only a saved prompt.

## Constraints and recovery

The current guide lists up to 16 agents at once, reduced when CPU is limited. It allows 1,000 total agents per run and up to 4,096 items in one `parallel` or `pipeline` call. Size guidance is advice, not a hard limit. The coordinator cannot directly use the filesystem, shell, or modules. Agents do that work. `Date.now`, `Math.random`, and `new Date()` with no arguments are blocked so replay stays deterministic. Agent permission checks still apply. Workflow consent does not grant every tool. Mid-run user sign-off needs separate workflow stages or runs. The guide treats this separately from agent permission prompts.

Resume is ordered replay, not arbitrary DAG memoization. Finished calls reuse saved results until the first changed prompt or failed call. That call and every call started after it run again. If B failed after A, B, C, and D started, A can be reused while B, C, and D rerun, even if C and D had finished. Saved results can be reused only when resuming the same saved Claude session. A fresh session has no replay history. This does not prove filesystem rollback or exactly-once side effects. Agents can return `null` after cancellation or an unrecoverable API error. Do not treat `null` as a successful empty audit.

## Cache and cost

Current docs say sibling prefixes can be shared when model, effort, agent type, tools, schema, and cwd match. Matching siblings wait until the first response starts, with a five-second default cap set by `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS`. Workflow-agent cache TTL defaults to five minutes. `subagentPromptCacheTtl=1h` asks for longer storage at a higher API cache-write price. A one-hour parent TTL does not give every child one hour. Prefix caching and replaying finished results are different. More review agents can still raise total cost.

## Comparison with die today

| Capability | Current die |
| --- | --- |
| Code controls stages, routing and verification gates | Yes, within a live `execute` invocation |
| Full isolated worker agents and model profiles | Yes: fast/normal/orchestrator; not prompt-only inference |
| Background child jobs, notifications, own-usage costs | Yes |
| Orchestrator agent containing the script, while root remains responsive | Possible with existing hierarchy |
| Claude-style agent call that resolves to a final structured value | Not equivalent: `subagent` defaults to a one-second launch wait and may return a running job |
| Schema-constrained worker return protocol | No first-class equivalent; explicit artifacts can be parsed and checked in code |
| Session-owned workflow script continuing after execute exits | No dedicated primitive; jobs survive, but `execute` variables and control flow do not |
| Hard workflow concurrency/total-agent budgets | No first-class workflow-wide contract; explicit code can bound fan-out |
| Persisted step replay/pause/resume with cached results | Not built; session JSONL, job history, and goal state are not script checkpoints |
| Phase-aware workflow monitor and saved workflow commands | Not built as workflow features |
| Cache-aware sibling launch staggering | Not built or checked as a scheduling feature |
| Restricted deterministic coordinator | No: `execute` intentionally allows filesystem, shell, imports, clock, and randomness |

`Promise.all` over normal `subagent` launches does not mean every worker has finished. The caller must inspect background status and read finished results. Today, a small workflow can use an orchestrator child with a bounded script. It can wait for workers, exchange checked JSON artifacts, and return one summary. Cancellation, handoff, and restart still need clear recovery. Do not claim automatic resume.

## Recommendation (not an approved implementation plan)

The pattern does not need a one-call prompt helper. Claude's own agent primitive is multi-turn. A useful addition would be a session-owned workflow scope under `execute`. It would wait for finished results, bound structured results, cap concurrency and total work, report phase events, and own cancellation. Replay is a separate design problem. Unrestricted `execute` side effects cannot be replayed safely by caching only model output. Start with one small fixed flow: implement, test, review independently, then make a bounded revision. Do not start with hundreds of workers. Keep evidence failures and unverified results separate from successful negative findings.

## Sources

- https://code.claude.com/docs/en/workflows (primary runtime, limits, replay, caching and UI contract)
- https://code.claude.com/docs/en/workflows.md (direct primary-source cross-check)
- https://platform.claude.com/cookbook/claude-agent-sdk-08-dynamic-workflows (worked fact-checking example and primitives)
- https://code.claude.com/docs/en/agent-sdk/typescript#workflow (tool input schema and SDK version)
- https://code.claude.com/docs/en/prompt-caching (parent/child prefix and TTL distinctions)
- https://code.claude.com/docs/en/sub-agents (ordinary delegation)
- https://code.claude.com/docs/en/agent-teams (peer coordination, distinct from scripted workflows)
- https://www.anthropic.com/engineering/building-effective-agents (older general architecture patterns)

This records documented behavior. It is not an independent run of Claude's closed workflow runtime. Limits and settings can change with versions.
