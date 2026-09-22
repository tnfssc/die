# Claude Dynamic Workflows research

Researched 2026-09-06 using tvly advanced search and extraction, cross-checked against the official workflows Markdown page. The tvly research endpoint was unavailable without an API key; this is primary-source research, not a completed Tavily Research API report. Source snapshots are retained under artifacts/research/ (ignored).

## Correction to the earlier answer

Claude Code has an actual Dynamic Workflows feature and Workflow tool. It is not merely the older Building Effective Agents pattern taxonomy, ordinary subagent delegation, skills, or agent teams. Its defining feature is an orchestration script executed by a background runtime, with intermediate results outside the lead model context.

## Execution model

1. Claude writes JavaScript beginning with a literal export const meta containing name and description, optionally phases.
2. Workflow accepts script, name, or scriptPath, plus JSON args and optional resumeFromRunId. scriptPath takes precedence. The TypeScript Agent SDK documents support from v0.3.149.
3. The runtime persists the script under the session directory and executes it in an isolated background environment.
4. agent(prompt, options) runs a full subagent, not one inference. The cookbook describes a clean task context and options including model, schema, label and phase.
5. parallel is an all-results barrier. pipeline moves each item through stages independently, allowing overlapping stages across items. phase and log provide progress metadata.
6. Script variables hold intermediate results; only the consolidated result returns to the lead conversation. SDK consumers must distinguish launch-turn ResultMessage from final completion, and can observe task progress/notifications.
7. Saved scripts in project or user .claude/workflows directories become named commands. This is persisted orchestration code, not just a saved prompt.

## Constraints and recovery

The current guide documents up to 16 concurrent agents (reduced with CPU availability), 1,000 total agents per run, and at most 4,096 items in one parallel/pipeline call. Size guidelines are advice, not hard caps. There is no direct filesystem/shell access or module loading in the coordinator; agents perform I/O. Date.now, Math.random and no-argument new Date are blocked for replay determinism. Permission checks still apply to agents; workflow consent does not mean unrestricted tool access. Mid-run user sign-off requires separate workflow stages/runs; the guide distinguishes this from agent permission prompts.

Resume is ordered replay, not generic arbitrary DAG memoization. Completed calls return saved results until the first changed prompt or failed call; that call and all subsequently started calls rerun. If B failed after A/B/C/D started, A can be reused while B/C/D rerun, including previously completed C/D. Saved results can be reused when resuming the same persisted Claude session; a fresh session has no replay history. This does not establish filesystem rollback or exactly-once side effects. Agents can return null on cancellation/unrecoverable API error; null must not be misclassified as a successful empty audit.

## Cache and cost

Current docs describe sibling prefix sharing when model, effort, agent type, tools, schema and cwd match. Matching fan-out siblings are held until the first response begins, capped at 5 seconds by default (CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS). Workflow-agent cache TTL defaults to five minutes; subagentPromptCacheTtl=1h requests longer retention with higher API cache-write pricing. A parent conversation's one-hour TTL does not imply an hour for every child. Prefix caching and replayed completed results are different mechanisms. More verification agents can still cost more overall.

## Comparison with die today

| Capability | Current die |
| --- | --- |
| Code controls stages, routing and verification gates | Yes, within a live execute invocation |
| Full isolated worker agents and model profiles | Yes: fast/normal/orchestrator; not prompt-only inference |
| Background child jobs, notifications, own-usage costs | Yes |
| Orchestrator agent containing the script, while root remains responsive | Possible with existing hierarchy |
| Claude-style agent call that resolves to a final structured value | Not equivalent: subagent defaults to a one-second launch wait and may return a running job |
| Schema-constrained worker return protocol | No first-class equivalent; explicit artifacts can be parsed/validated in code |
| Session-owned workflow script continuing after execute exits | No dedicated primitive; jobs survive, execute variables/control flow do not |
| Hard workflow concurrency/total-agent budgets | Not a first-class workflow-wide contract; explicit code can bound fan-out |
| Persisted step replay/pause/resume with cached results | Not implemented; session JSONL/job history/goal state are not script checkpoints |
| Phase-aware workflow monitor and saved workflow commands | Not implemented as workflow features |
| Cache-aware sibling launch staggering | Not implemented or validated as a scheduling feature |
| Restricted deterministic coordinator | No: execute deliberately permits filesystem, shell, imports, clock and randomness |

Promise.all over ordinary subagent launches is not an all-workers-finished barrier. The caller must check background/status and consume completed results correctly. For a modest workflow today, an orchestrator child can run a bounded script, wait explicitly for launched workers within its execution, exchange validated JSON artifacts, and return a final summary. Cancellation/handoff/restart still need explicit recovery; do not claim transparent resumability.

## Recommendation (not an approved implementation plan)

We do not need a single-call prompt helper to adopt the pattern: Claude's own agent primitive is multi-turn. The meaningful potential addition is a session-owned workflow execution scope under execute, with completed-result waiting, bounded structured results, concurrency/total-work budgets, phase events and explicit cancellation ownership. Replay should be a separate design: unrestricted execute side effects cannot safely be replayed just by caching LLM outputs. Start with a small fixed implement -> test -> independent review -> bounded revision workflow, not hundreds of workers. Keep evidence failures and unverified results distinct from successful negative findings.

## Sources

- https://code.claude.com/docs/en/workflows (primary runtime, limits, replay, caching and UI contract)
- https://code.claude.com/docs/en/workflows.md (direct primary-source cross-check)
- https://platform.claude.com/cookbook/claude-agent-sdk-08-dynamic-workflows (worked fact-checking example and primitives)
- https://code.claude.com/docs/en/agent-sdk/typescript#workflow (tool input schema and SDK version)
- https://code.claude.com/docs/en/prompt-caching (parent/child prefix and TTL distinctions)
- https://code.claude.com/docs/en/sub-agents (ordinary delegation)
- https://code.claude.com/docs/en/agent-teams (peer coordination, distinct from scripted workflows)
- https://www.anthropic.com/engineering/building-effective-agents (older general architecture patterns)

This reports documented behavior, not an independent run of Claude's proprietary workflow runtime. Specific limits/settings are version-sensitive.
