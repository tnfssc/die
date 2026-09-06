# die — Product Reference

> This document records the product direction and decisions stated by the user in this project conversation. Those statements are the source of truth. Implementation details may support them, but must not silently become product requirements.

## Current contract and hardening status (2026-09-05)

This section describes the current product; the phase/milestone sections below retain historical decisions and evidence, not competing current interfaces.

- One model-facing tool: `execute`. Shell, delegation, jobs, goals, images and cooperative handoff are helpers. Workers are isolated; managed jobs belong to the session. Default launch wait is one second, independently of job lifetime.
- Root can delegate to orchestrators and leaves; orchestrators can delegate to fast/normal leaves. No deeper delegation. Result delivery must have one owner: foreground or background notification.
- Durable history, bounded output/diagnostics, descendant own-usage costs and quiet startup remain required. Markdown is the editable source for model-facing prose; explicit custom prompts and project/skill context remain supported.
- Codex uses opaque native compaction with documented provider/model and capture restrictions. Other providers summarize the current transformed conversation through normal provider hooks. Failures preserve history; no hidden paid fallback. Cache availability, savings and quality are separate validation claims.
- Main-agent `/mode fast|normal|orchestrator` changes instructions only (default orchestrator), with durable branch-scoped selection. `/ps` provides bounded live job inspection and ID-stable confirmed stopping. `/resume` adds scoped role labels and interactive child-session confirmation.
- Attention uses one session scheduler: five-minute quiet and ten-minute review checkpoints, snooze up to 55 minutes, and explicit watcher suppression. It reports observations, never automatically kills work. Per-agent/model cache countdowns are configurable informational estimates, nominally one hour, not cache guarantees.
- Goal mode is opt-in, durable and branch-scoped, with active/waiting/blocked/completed/paused states. Goal context follows the normal filtering lifecycle. Successful handoff can record owned waiting work; automatic run boundaries enforce a no-progress guard based on explicit milestone evidence, not job/revision churn. Model-authored completion evidence still requires independent verification.
- Formatting and recommended lint checks, CI/tag-release workflows, contributor documentation and MIT licensing are implemented. Persistent execute remains exploratory; this does not claim Codex client parity.
- Current changes are built and tested, not locally installed. Installation still requires explicit authorization; no release tag or release publication has been created.

### Active review fixes

User authorized fixing the review findings and strengthening validation. Existing dirty work and failed evidence are preserved.

- [x] Preserve effective instructions through notification-triggered multi-tool turns, without repeating arbitrary framing-hook side effects. SDK coverage includes successful tool results, custom/empty prompts, frame updates, owning-manager isolation, lifecycle cleanup and fresh compaction. Root added a failing next-turn-refresh regression and synchronized the SDK private override immediately; red evidence: `/tmp/die-frame-refresh-red.log`.
- [x] Resolve transitive installed-package imports in the compiled execute worker; 21 compiled runner tests now cover representative SDK imports, TypeScript erasure, symlinked graphs, native CJS cycles/cache/conditions, mixed ESM/CJS, lazy imports, assets and failed evaluation identity. Intermediate non-bundling revision passed 14/15 runner tests but failed the representative SDK CommonJS dependency (`graceful-fs`). Compiled Bun skips runtime onResolve for external imports. This failed evidence is retained; a directory-scanning fallback was rejected for per-execute overhead.
- [x] Recover notification ownership if the execute connection disappears before inline delivery is acknowledged. ACKs commit only after clean worker exit; production composite waits preserve separate delivery identity. Regressions cover disconnect, crash-after-ACK, oversized/error replies, batched subagents, partial batch failure and inline-then-handoff without duplicate notice. Root verified 45 focused ownership/handoff tests. Subsequent integrated gates passed (see milestones below).
- [x] Parse native compaction SSE incrementally, stop at terminal events, and retain available usage on failures/cancellation. Root verified 27 native protocol/SDK tests, including CRLF/UTF-8 fragmentation, reset/no-EOF completion, cancellation, byte bounds and duplicate final output rejection.
- [x] Extract remaining substantial execute description prose to `src/prompts/execute-description.md`, preserving text and testing registration against the embedded source.
Root integration review rejected two incomplete first passes: graph bundling changed module identity/asset semantics, and acknowledgement metadata was lost through the production composite AbortSignal. Native parsing also needed CRLF-boundary and duplicate-final-item checks. These are being corrected before acceptance, not papered over by passing isolated tests.

- [x] Integrate regressions, typecheck/build/smoke and real-terminal/model validation. Prior medium successes do not establish minimal-reasoning reliability, and previous passing tests missed real integration bugs.

## Planned — Job attention checkpoints and cache countdown

Status: agreed product direction, not implemented. These requirements supplement the current hardening work; they do not change job lifetimes or authorize installation.

### Attention for long-running jobs

- Notify the owning parent agent when a running job may need attention, independently of completion notifications. A notice resumes the agent through the normal continuation mechanism so it can inspect the job and decide what to do.
- Default quiet notice: **5 minutes** without observable activity.
- Default review checkpoint: **10 minutes**, regardless of output activity. Continuous redraws (for example, a terminal monitor) must not postpone review indefinitely: output is not proof of useful progress.
- An agent can snooze review, with a **55-minute maximum snooze**. Snoozing should defer attention coherently rather than leaving another routine alert immediately due.
- These are attention deadlines, not automatic cancellation or execution timeouts. Jobs continue running unless explicitly stopped or subject to a separately configured execution deadline.
- Notices describe evidence, not a guessed diagnosis: elapsed time, last observable activity, bounded recent output/output volume, and whether stdin is open. Silence does not prove a hang or a wait for input; open stdin alone does not prove the process is reading it.
- Available responses include inspection, supplying input, closing stdin, stopping obsolete work, leaving the job running, or snoozing. Expected persistent services/watchers can suppress routine reminders while retaining failure/completion reporting.
- Batch and deduplicate attention notices. Send one quiet notice per quiet episode; meaningful activity can re-arm it. Review reminders follow scheduled checkpoints or explicit snoozes, not every output event. Do not repeatedly trigger model turns for the same overdue condition.
- Preserve the distinction between an assistant finishing its turn and its process finishing all owned work. Pending-job information must remain useful when a subagent has produced a report but still owns running jobs.
- Keeping attention gaps below roughly an hour is intended to help cache reuse, not guarantee it. Provider retention varies. Do not issue empty keepalive inference requests solely to refresh a presumed cache.

### Resource-safety requirements

- Use one deadline scheduler per owning session, not periodic polling or one interval per job. Schedule the next relevant deadline and recheck/reschedule when it fires.
- Reuse existing output, tool, model and input events for lightweight activity timestamps. No routine process scans, repeated log reads, or expensive analysis of every redraw.
- No timer recreation/render storm for every output chunk. No busy-waiting, recursive notification loops or accumulating stale scheduled entries.
- Bound scheduler state, notice size and retained diagnostics. Clean up deadlines/listeners on completion, cancellation and session shutdown.
- Validate rather than assume low overhead: stress many concurrent jobs and noisy streams; measure CPU, memory, timer callbacks, UI renders and notification volume. Exercise quiet jobs, indefinitely updating jobs, snoozes, batching and lifecycle cleanup with controlled clocks where practical. Preserve the existing at-least-50-concurrent-task test requirement.

### Per-agent footer cache countdown

- Add a countdown alongside the existing footer branch, cost and context information.
- The configured nominal cache TTL defaults to **1 hour** and is user-configurable.
- Count down from the last actual LLM call in that particular agent. Descendant or unrelated-agent calls must not reset the displayed agent's countdown, even though footer cost includes descendants. Tool activity, output, attention notices alone and UI redraws do not refresh it.
- Display remaining estimated retention time, with progressively stronger warning colors as the deadline approaches. Exact warning thresholds and formatting are to be chosen during implementation; retain a readable text indication rather than relying on color alone.
- Refresh coarsely as the displayed value/color needs to change; per-second updates are not required. Avoid extra high-frequency timers and redundant TUI renders, and clean up on disposal/session changes.
- Label this as an estimate based on configured TTL, not proof that a provider cache exists, was refreshed, or will produce a cache hit. At expiry show an expired estimate rather than negative time; before a known call do not invent a fresh countdown.
- Before implementation, define the precise request timestamp/reset semantics (start versus completion; failures, retries and compaction), session-resume behavior, and provider/model-switch behavior. The UI must not imply that a call refreshed a compatible cache when that is not known. Configuration surface and persistence also remain implementation decisions.
- The countdown is informational: it must not itself make provider requests, cancel jobs or end sessions. Test per-agent isolation, configurable TTL, warning/expiry states, clock progression and idle rendering cost.

## Planned — Goal mode

Status: user-approved direction, not implemented. Goal mode prevents accidental abandonment of an assignment without preventing responsive yielding.

### Persistent objective and explicit state

- Opt-in, initially one explicit goal per agent. Ordinary chat retains its existing behavior; not every user request silently becomes a persistent obligation.
- Store the objective, completion criteria, constraints, current status, and applicable blocker or pending-job references. Goals and status must survive compaction rather than depend on the model remembering them.
- **Active:** actionable work remains; continue pursuing the goal after the current turn ends.
- **Waiting:** progress depends on owned background work; yield and resume on completion or an attention checkpoint, not repeated goal reminders. A running test is not automatically a blocker requiring user intervention.
- **Blocked:** user input, permission or another unavailable prerequisite is needed; explain what would unblock progress and stop automatic continuation.
- **Completed:** agreed completion criteria are satisfied; report evidence and stop automatic continuation.
- **Paused:** the user interrupted/suspended the goal, or a no-progress safeguard paused it; do not automatically restart it.
- Completion and blocker claims are agent assessments, not independent runtime verification. Completing a goal requires supporting evidence; marking it blocked requires an explanation of the unmet prerequisite.
- Goal mode does not expand permissions or override constraints, such as requiring explicit authorization before installation.

### Turn-boundary continuation

- A normal text-only response still ends the current agent turn. Once the current tool batch has settled, inspect the explicit goal state.
- If the goal remains active, append a concise automatic continuation message containing the current objective and completion criteria, and resume the agent. The agent should continue actionable work or explicitly update goal status.
- Checking recorded goal state is runtime bookkeeping, not a separate inference request to judge whether the goal is complete.
- Expose explicit goal-state updates through the existing single model-facing execute interface (a helper), not a second model-facing tool. Exact helper/configuration/UI shape remains an implementation decision.
- Waiting, blocked, completed and paused goals do not trigger immediate reminder loops. Coordinate with job completion and attention notifications to avoid duplicate continuations for the same boundary.
- Queued user messages take precedence. Explicit interruption/cancellation pauses automatic goal pursuit; it must not immediately restart the loop. Users can revise, pause or cancel a goal without fighting automatic continuation.
- Repeated continuations producing neither work nor a meaningful state change should pause and surface lack of progress, rather than invent a blocker or spend indefinitely. Thresholds and how progress is established must be designed and tested, not inferred from output volume alone.
- Delegated goals are separate; the parent remains responsible for deciding whether descendant results satisfy its own goal.

### Implementation and validation boundaries

- Preserve responsive handoff and the existing per-job attention scheduler. Goal mode must not turn waiting into busy polling, repeated model keepalives or high-frequency timer/UI work.
- Define durable goal storage, resume behavior, explicit status-transition mechanics and no-progress safeguards before implementation. Avoid replaying an obsolete reminder after a user changes the goal or pauses the session.
- Test active continuation, evidence-backed completion, actionable blockers, waiting on owned jobs, attention/completion batching, interruption and queued user input, goal revision, compaction/resume, and repeated no-progress turns. Verify bounded notification/model-call behavior as well as correctness.

## Identity and foundation

- The product and executable are named lowercase `die`.
- `die` is a CLI coding agent built from Pi. Whether this is described as a fork or a packaged version is unimportant; Pi runs underneath it.
- Bun compile produces a standalone binary so using the resulting CLI does not require a separate Bun, Node.js, Pi, or project dependency installation.
- Builds use the latest confirmed stable Bun release. The current pinned build version is Bun 1.4.1.
- Development follows three phases in order.

## Configuration and installation

- Pi normally uses `~/.pi`; `die` uses `~/.die`.
- Pi authentication may be copied into `~/.die` for testing.
- A local install command installs the executable into `~/.local/bin` so `die` can be run from the terminal.
- Updates are disabled for now.

## Testing and interactive tooling

- Tests that use an LLM use `openai-codex/gpt-5.6-luna`.
- The system must be tested as a whole with the model, its prompts, and realistic work—not only isolated unit tests.
- Interactive tests exercise the real Pi-style TUI through a pseudo-terminal.
- Test tooling can inspect the current display and prior history, record frames, interact during a session, send follow-ups, and cleanly stop the session.
- Only the TUI harness session named `demo` is automatically killed after 60 minutes. Other interactive sessions are not subject to that watchdog.
- Background task handling must not cause high-frequency terminal rendering or avoidable CPU and memory spikes.
- The asynchronous system must be exercised with at least 50 concurrent tasks.

## Phase 1 — Compiled CLI

- Build a Bun-compiled binary named `die` that launches Pi underneath and behaves as a standalone CLI coding agent.
- Preserve the useful Pi CLI and terminal experience except where later `die` requirements intentionally change it.

## Phase 2 — Asynchronous tasks and agents

- The product term for this direction is “asynchronous agents,” while the underlying primitive also supports ordinary commands and other background work.

### Generic tasks

- Replace model-facing shell execution with an asynchronous task primitive.
- A task can represent a command, a sub-agent, or another long-running unit of work.
- The agent can spawn a task, inspect it, and interact with it through standard input or an equivalent channel.
- Spawning does not block the agent loop. While work runs, the agent remains free to reason, call tools, start or manage other tasks, and do useful work.
- Completion automatically notifies the agent, analogous to an event arriving on the JavaScript event loop.
- While an answer depends on unfinished work, the agent may acknowledge that work is running but should not invent placeholder results or present a premature final answer.
- The model-facing generic task operations are `spawn`, `list`, `inspect`, `input`, and `kill`.
- Spawn responses include task IDs.
- A completed task remains inspectable for the rest of the current session. Because retained results are inspectable, completion overflow does not need to be written to a file.
- Task output is buffered without rendering every output chunk. Retention is bounded per task and implemented to avoid repeated whole-buffer copying or retaining oversized pooled backing buffers for small chunks.
- Completed tasks retain inspectable metadata and bounded output, but release their child-process objects, streams, and completion machinery immediately.
- Aggregate session memory and global concurrency limits are not required at this stage.
- The command task intentionally uses the user's configured shell. Shell-specific behavior is expected.
- Session shutdown terminates running task process groups and escalates termination when necessary.

### Completion delivery

- Completion notifications arriving in bursts are batched before delivery to the model.
- A completion notification is limited to 5,000 characters. Large batches should normally use much less by showing a few compact result previews plus the remaining task IDs instead of filling the terminal with repetitive blocks.
- The notification provides previews; full retained output remains available through task inspection.
- Task IDs for completion blocks omitted from the preview are included compactly when they fit within the same limit, with `task list` available to recover all IDs.

### Listing and inspection

- `task list` must not produce unbounded model-context output. It is paginated and displays concise command previews and elapsed time; the exact preview presentation is an implementation choice that should remain understandable and must never alter execution.
- While tasks are running, the TUI footer shows a persistent running-task count so an idle agent does not look stalled.
- Background agents expose a bounded, timestamped live activity log through task inspection, including tool starts/results, assistant text, retry events, and errors. Inspection shows model/type, session path, last observed activity, quiet duration, and current tool. Reasoning content and images are not included in activity previews. A quiet interval is not proof of a hang.
- Commands are always executed in full. Display shortening applies only to presentation.
- Task inspection returns at most 5,000 output bytes per page (reduced from 50,000), excluding metadata/formatting. It uses cursors and preserves UTF-8 characters at page boundaries. The existing tiny-page exception allows a single complete UTF-8 character.
- Retained task output remains bounded to 1 MB per task; smaller inspection pages do not reduce retention. The separate execute output limits are unchanged by this decision.
- Standard output and standard error are currently merged. Separating and labeling them is deferred and should remain noted in the code.

### Sub-agents

- `subagent` is a specialized capability built on top of the generic asynchronous task system.
- It launches isolated background `die` agents and returns their task IDs immediately.
- The parent manages them through the generic task lifecycle and receives automatic completion notifications.
- Sub-agents have three types: `fast`, `normal`, and `orchestrator`. The calling agent chooses the type appropriate to the work.
- Each type has independently configurable model and thinking settings, editable both through the TUI and a configuration file. Unconfigured values inherit from the parent.
- The /subagents UI should be ergonomic like /model: a searchable model/provider picker with an Inherit from parent option, direct access to thinking settings, and preserved settings-row selection when returning from a picker.
- `fast` is for narrowly scoped non-implementation work: reconnaissance, scouting, research, and information gathering. `normal` primarily implements and debugs with independent judgment. `orchestrator` coordinates and delegates rather than doing most implementation itself.
- A sub-agent can use normal coding capabilities and generic asynchronous command tasks.
- Delegation is limited to three tiers total (root included): root → spawned orchestrator → fast/normal worker. The root may also spawn fast/normal workers directly.
- A spawned orchestrator may create fast/normal workers, but may not create another orchestrator. Workers cannot delegate. There must be no fourth tier. This refines the original two-level-below-root rule by forbidding orchestrator profiles at the final worker tier.
- `fast` and `normal` sub-agents cannot delegate. The root retains delegation capability.
- Root-to-level-one delegation remains asynchronous. Because first-level agents run in non-interactive print mode, their level-two delegation waits inside the `subagent` tool call and returns the nested output before the first-level process can exit.
- Second-level sub-agents are leaves: they do not receive the model-facing `subagent` capability and cannot delegate further.
- The two-level rule is functional behavior, not a security boundary against a process deliberately modifying its environment and invoking executables itself.

### Lightweight role instructions (planned)

- Give each sub-agent type a short role-specific system instruction. These instructions steer behavior without large prompts or excessive procedural rules.
- Orchestrator: primarily decompose goals, delegate, coordinate, review, and synthesize. Prefer assigning implementation to normal agents instead of doing it all directly. Accept higher-level objectives and decide how to break them down.
- Normal: primarily implement, debug, test, and make reasonable local design decisions independently. Act as the implementation lead/second-in-command; do not require the orchestrator to prescribe every detail. Normal agents still cannot spawn sub-agents.
- Fast: focus on non-implementation work such as reconnaissance, scouting, research, and focused checks. Follow a specific bounded assignment; do not independently expand the scope or start implementing changes. Report useful findings and uncertainties.
- Calling agents should give fast agents precise objectives, scope, and expected results; normal agents can receive implementation goals with room for judgment; orchestrators can receive broad coordination objectives.
- These role instructions are behavioral guidance, not a new security sandbox or additional tool permission boundary. The existing orchestrator-only delegation and two-level depth limits remain in force.

### Main-agent instruction switching (planned)

- Allow the user to switch the main agent between the same fast, normal, and orchestrator instruction sets through a TUI slash command.
- This changes behavioral instructions, not necessarily the model or thinking settings. Automatic model/profile switching is not requested by this requirement.
- The main agent defaults to orchestrator mode. The user can switch to normal or fast instructions through the TUI.
- The exact slash-command name remains to be decided.
- This default applies to the main agent instruction mode, not to the type of every spawned agent; delegation should still select the appropriate type.
- Decide separately whether choosing fast/normal instructions on the main agent changes its delegation permissions; the existing sub-agent permission rules do not implicitly settle main-agent behavior.

### Tool selection

- `task` is a core capability, and `subagent` is a core capability for root agents.
- Pi's model-facing `bash` and `powershell` tools are disabled in favor of `task`.
- Generic Pi options intended to disable or select model-facing tools are removed from `die`; they must not override the core `die` tool model.
- Other file tools remain until Phase 3.

## Phase 3 — One TypeScript execution tool

- Remove the model-facing `read`, `edit`, `write`, and shell tools.
- Replace them with exactly one general-purpose model-facing tool named `execute`. It accepts and executes TypeScript, but is not named `typescript`. The specialized asynchronous `task` and `subagent` capabilities remain alongside it.
- The model performs reads, writes, edits, and synchronous command execution by writing TypeScript for this tool.
- The tool executes the submitted TypeScript and returns its output or result.
- TypeScript is the initial language.
- Submitted source is transpiled in memory with Bun's internal `Bun.Transpiler` and executed as a module in an isolated child process.
- Module execution supports top-level await, top-level static imports and exports, dynamic/lazy imports, and CommonJS `require`, including local modules and installed packages resolved from the working directory.
- Errors from in-memory modules must use a readable placeholder instead of exposing long base64 data URLs.
- No temporary source file is written.
- The isolated process uses the agent's current working directory and may use Bun APIs, Node built-ins, installed packages, and subprocesses.
- Isolation protects the main agent process from crashes, exits, and global mutations in submitted code; it is not specified as a filesystem or operating-system security sandbox.

## Post-baseline — Compact execution and completion views

- The collapsed execute TUI view shows the first few input lines and the last few output lines, with an explicit ellipsis wherever intervening content is hidden.
- Large task-complete notifications also collapse with an ellipsis instead of occupying large terminal blocks.
- Bound collapsed previews by rendered terminal rows, including wrapped long lines, not just source lines or character counts.
- Expansion reveals retained input/output or notification content. This is presentation-only: model-facing content and existing retention/truncation budgets are unchanged.

## Post-baseline — Image results

- The existing `execute` tool can return images to the model for screenshot inspection and visual debugging.
- Keep the three-tool model; do not restore a separate model-facing image/read tool.
- See [`docs/execute-images.md`](./docs/execute-images.md) for the helper API, implementation limits, and validation.

## Post-baseline — Interactive task monitor (planned)

### Monitor phase 1 — View and stop

- Add a user-facing TUI slash command named `/ps` for tasks and sub-agents. This is separate from the model-facing `task` tool.
- Show all running tasks and sub-agents in the current session.
- Up and Down arrow keys move the selection between entries.
- Allow the user to preview the selected task's current available output and see what is happening inside it without asking the agent to inspect it.
- Allow the user to stop the selected task or sub-agent.
- The monitor must respect the existing bounded-output and low-overhead rendering requirements.
- Include a live sub-agent progress feed in monitor phase 1, rather than waiting for the final answer. The user must be able to see available activity/output while a sub-agent is working.
- Expose available progress through both the `/ps` preview and task inspection, using bounded retention and throttled rendering. Distinguish “no output available yet” from inactivity.
- Live progress must preserve automatic final-completion delivery and must not flood the parent agent with per-event notifications.
- The exact event format remains an implementation detail; progress means observable status, tool activity, and available output, not a requirement to expose private model reasoning.
- Nested-task visibility and the exact preview/stop key bindings remain design details to settle during implementation.

### Monitor phase 2 — Interactivity (deferred)

- Extend the monitor to interact with running tasks/sub-agents, rather than only viewing output and stopping them.
- The input/interaction mechanism and supported task types will be discussed separately; they are not part of monitor phase 1.
- These monitor phases are incremental post-baseline work, not a reopening of the original three development phases.

## Post-baseline — Persistent sub-agent sessions

- Sub-agent conversations and tool history are persisted as normal Pi JSONL sessions instead of launching them with --no-session. Session headers and identifying metadata are written before launching so a pre-response stall still has a durable identity.
- Use normal agent-session retention behavior. No additional cleanup policy or automatic expiry is required.
- Record enough session metadata to identify a session as a sub-agent and associate it with its parent/job and sub-agent type.
- Sub-agent sessions must be clearly distinguished in the /resume picker so the user does not accidentally resume into one.
- In /resume, spawned orchestrators receive a distinct “orchestrator agent” identity, not a “sub-agent orchestrator” label. Fast/normal workers retain explicit sub-agent labels. Color may provide an additional distinction, but the exact presentation and selection safeguard remain to be designed.
- Sub-agent sessions need not be hidden from /resume. The requirement is clear identity and deliberate selection rather than accidental resumption.
- Persisted history does not mean loading the full history into the parent model context; bounded job output and live-progress plans still apply.

## Post-baseline — Unified execute API

- Move model-facing shell execution, sub-agent delegation, and background-work management into helpers callable from the existing execute tool.
- Use “jobs” as the shared name for managed background shell commands and sub-agents. The internal task manager can remain an implementation detail.
- Target helper API: shell(command, options), subagent(options), jobs.list(), jobs.inspect(id, options), and jobs.stop(id). Preserve existing input/close-input and timeout capabilities through the job API as well.
- Sub-agent helpers retain fast/normal/orchestrator profile selection and the existing role/depth restrictions. Moving delegation into execute must not bypass those restrictions.
- The /ps monitor uses the same job registry as execute helpers.

### Short foreground wait with background fallback

- Shell commands and sub-agent launches start as managed jobs and wait up to one second by default.
- Expose waitSeconds: zero returns immediately in the background; larger values allow a longer foreground wait.
- If work finishes within the wait window, return its result directly in the execute call without a separate completion notification.
- If it remains running, return its job ID and deliver automatic completion later.
- The foreground wait deadline is not an execution timeout: reaching it must not terminate the job. Execution timeouts remain separate.
- Completion at the foreground/background boundary must be delivered exactly once, with neither lost nor duplicate results.
- Keep returned output bounded and preserve cursor-based retrieval of retained output.

### Ownership and migration

- Jobs belong to the main die session, not the short-lived execute worker. Background work must survive normal execute-worker exit and still be cleaned up on session shutdown.
- Add a communication bridge between isolated execute workers and the session-owned job manager. This does not require a persistent JavaScript/REPL context.
- The execute helpers replace the separate model-facing task/subagent tools. Only execute is registered; delegation remains available inside it with server-side role/depth validation.
- This planned post-baseline direction supersedes earlier requirements for keeping three separate model-facing tools once migration is complete; the single-tool migration supersedes the earlier three-tool baseline.

## Ideation — Persistent execution context

- Investigate an opt-in REPL-like execution context that can reuse values and results across execute calls rather than starting a fresh JavaScript context each time.
- This is an exploration, not a committed feature or replacement for isolated execution.
- Evaluate memory retention, startup savings, hidden-state/retry behavior, concurrent-call serialization, and timeout/crash recovery.
- Possible design: a lazy persistent worker per agent, explicit state storage, reset controls, memory visibility, and continued availability of isolated execution. These are proposals, not settled requirements.
- Benchmark isolated versus persistent execution under controlled load before choosing a direction.

## Shelved idea — Project-local memory

- Revisit a simple, lightly structured filesystem for project-local agent notes under .agents/notes/.
- Candidate structure: nested topic directories with small index.md files describing immediate children; focused Markdown notes, read selectively by following relevant branches.
- Keep the concept filesystem-based; a database, search service, or dedicated memory tools are not the requested direction.
- This is shelved for later discussion. The structure and prompt guidance are not finalized; do not implement it yet.

## Post-baseline — Combined session cost

- Show combined cost in the footer: the main session plus all spawned orchestrator and worker descendants.
- Attribute each descendant's usage exactly once; nested aggregation must not double count costs.
- A detailed cost breakdown and its presentation remain undecided; combined cost is required regardless.
- Implemented using persisted die-agent parent/session links. Both footer modes add each descendant’s own assistant, tool-result, compaction and branch-summary usage cost once; intermediate orchestrator totals are never propagated or summed again.
- The compact footer shows the combined cost; expanded /status marks it as total. Token/cache/context figures remain local to the current session. Amounts are provider-recorded price estimates, not authoritative invoices or subscription charges.
- Incremental, read-only JSONL scanning refreshes costs roughly every second, including completed/failed workers and resumed sessions. Unrelated sessions and ordinary forks with copied metadata are excluded. No extra cost ledger is written.
- In-memory (--no-session) parents receive a stable attribution identity for the current run, without writing a fake parent session.
- Deterministic coverage includes nesting, deduplication, truncation/replacement, partial records, synthetic roots and footer cleanup. Real-terminal coverage verifies live idle updates, expanded totals and restart restoration.

## Disk-write policy

- Keep disk writes to the bare minimum necessary.
- Pi's normal persistence behavior is acceptable.
- Features added by `die` should remain in memory unless writing is necessary for their requested behavior.
- Do not rewrite or edit files when their contents do not need to change.
- Standalone runtime assets may be materialized because Pi requires filesystem paths, but unchanged assets must not be rewritten on every launch.
- TUI recordings and captures are intentional writes requested by the testing workflow.

## Explicitly deferred or unnecessary work

- Global task concurrency limits are not required.
- A global retained-output memory budget is not required.
- Normalizing all command tasks to one shell is not desired.
- Longer task IDs are unnecessary.
- Treating the leaf-subagent mechanism as an adversarial security boundary is unnecessary.
- Additional authenticated LLM coverage specifically for the recursion guard is unnecessary; deterministic coverage and real-TUI validation are sufficient.
- Cross-platform release builds can be handled later.

## Pending post-baseline work

- Sub-agent types and independent profile settings: implemented with /subagents TUI editing and ~/.die/subagents.json. Typecheck, compiled build, deterministic suite (122 passed; 7 opt-in LLM tests skipped), and standalone smoke validation passed. The ergonomic /subagents panel now provides fuzzy model/provider search, exact-match prioritization, inheritance, direct thinking selection, and preserved settings-row selection. Its real-TUI search/edit/save flow is validated. The latest full suite passed 134 tests (8 opt-in LLM tests skipped), with typecheck/build and diff checks passing. Lightweight role-specific system instructions and subsequent hierarchy refinements specified above remain to be integrated and validated.
- Interactive task monitor (`/ps`): not yet implemented. The session-owned live-progress feed and task inspection diagnostics are implemented as its foundation.
- Monitor interactivity: deferred to monitor phase 2.
- Persistent sub-agent JSONL sessions, identifying session names in /resume, parent/job/model metadata, and bounded live diagnostics through task inspection: implemented. Typecheck/build, 129 deterministic tests, standalone smoke, and a real GPT-5.6 Luna delegation/persistence test passed. Dedicated picker styling/selection safeguards remain open.
- Unified execute helpers and session-owned jobs, including the one-second foreground wait: implemented. Validation passed: 119 deterministic tests, typecheck/build, standalone smoke, and three real GPT-5.6 Luna tests covering inline shell results, background completion, and sub-agent persistence.
- Combined parent/descendant footer cost: implemented and validated. 130 tests passed (7 opt-in LLM tests skipped), including real-terminal live-update/resume coverage; typecheck/build, smoke and diff checks passed. Independent aggregation of this session’s 10 saved descendants matched exactly ($1.49327548 at validation time).
- Three-tier hierarchy with no nested spawned orchestrators and distinct orchestrator identity in /resume: implemented.

## Current phase

Phases 1, 2, and 3 are established for the current Linux/Bun baseline as of 2026-09-05. Phase 3 includes the isolated `execute` tool, module-loading and output hardening, pending-task continuation, and awaited process-group shutdown. See [`docs/phase3-baseline.md`](./docs/phase3-baseline.md) for validation evidence and remaining limitations. Cross-platform release work and the explicitly deferred items above remain deferred.

## Post-baseline — Natural execute/background UX audit

- The initial unified API tests prescribed exact code and yielding; natural-behavior coverage was missing.
- A deeper audit reproduced polling, direct-process blocking, inflated foreground waits, and prematurely short agent timeouts.
- Added immediate background-handoff feedback to execute results and clarified foreground budgets, command helpers, session-local job IDs, and execution timeouts.
- Hardened notification callbacks and labeled failed-agent progress as diagnostic rather than a final answer.
- Added natural nested-agent and real-terminal responsiveness/interruption probes plus deterministic wall-clock and cancellation coverage. Findings, evidence, limitations: docs/background-ux-audit.md.
- Validation passed: 140 deterministic tests; repeated natural nested-agent and real-TUI background/responsiveness runs; real-TUI Escape interruption with managed-job survival and automatic continuation; typecheck/build, smoke and diff checks. Changes are built, not installed.

## Post-baseline — Values-oriented guidance

- Behavioral guidance should express values and causal explanations, allowing agents to infer appropriate actions rather than accumulating prohibitions.
- Centralized die-owned working values, technical reference, role guidance and handoff text in src/prompts.ts. Values: responsiveness, purposeful attention, evidence, proportionate effort, and ownership.
- Retained precise API/capability facts and all runtime validators. User/project prompts and upstream Pi instructions retain their existing precedence.
- Supersedes the imperative prompt wording from the previous UX remediation, not its desired behavioral outcomes; the same natural UX probes are being rerun.
- Prompt rationale and scope: docs/prompts.md. Separate follow-up: repair generated runtime documentation links/assets rather than adding instructions to compensate.

- Values-oriented prompt revision status: **draft, not install-ready**. Final deterministic/typecheck/build/smoke checks passed (143 tests), but repeated natural model runs still regressed: the latest terminal case held a 25-second command in execute via waitSeconds:30, and the nested case did not create the requested orchestrator. These are behavioral failures, not transport failures. No installation was performed. Further work should improve clarity/affordances rather than restore prohibitions or relax responsiveness criteria.

### Values iteration 2 — decision points

- Simplified registered guidance by 31% (5,664 → 3,907 characters), preserving values, API facts, user workflow ownership, and runtime guards.
- Added tests/prompt-delivery.test.ts to verify Pi SDK system-prompt assembly; this is not a provider-wire capture.
- Fixed evaluation budget: two natural nested-agent/TUI pairs with unchanged prompts and criteria. Both pairs failed both cases (0/4 live scenarios): requested nested delegation and responsive handoff remain unreliable. 144 deterministic tests, typecheck/build, smoke and diff checks passed. Not install-ready and not installed.

### Values iteration 3 — explicit control affordance

- Moved values into the agent frame; retained API mechanics with execute. Explicit user system prompts retain override behavior.
- Added cooperative await handoff(message) inside execute: bounded visible progress, module unwinding, released foreground waits, preserved jobs, native Pi batch termination. This remains one model-facing tool and a voluntary action, not a scheduling prohibition.
- Clarified profile capability selection and foreground latency causally. Added real SDK stream-context and Codex serializer tests; no provider-wire claim.
- Clarified the natural fixture’s request for a separate orchestrator and used runtime metadata to detect background ownership/explicit handoff. No latency or responsiveness assertions were relaxed.
- Minimal reasoning remains unreliable: the final first pair passed, but confirmation nested root polled; terminal and Escape passed. Earlier failed iterations remain documented in docs/prompts.md.
- Medium matches the SDK default and this session’s inherited profile setting. Two unchanged medium batches passed nested, terminal, and Escape (6/6). Leaf return times: 938/941 ms for 15,006/15,005 ms commands. Production preferences remain untouched; historical probes still default to minimal.
- Implementation complete and validated at the tested medium setting; minimal stress remains unreliable. Built, not installed. Final deterministic validation: 160 passed, 10 opt-in skips (922 assertions, 37 files); typecheck/build/smoke/diff checks passed.

### Prompt Markdown sources

- Moved die-owned prompt prose to `src/prompts/*.md`; `system.md` is the main editable system fragment. `src/prompts.ts` imports embedded text and performs only list adaptation and dynamic role/job substitutions.
- Verified pre/post-extraction prompt outputs match byte-for-byte. Added Markdown-source equality coverage and retained SDK delivery/serializer coverage. Pi continues composing its base and dynamic context; this is not a static copy of the entire session prompt.
- Built, not installed.

### Local installation

- Installed the current build to `/home/tnfssc/.local/bin/die` at the user’s explicit request with `bun run install:local`. Includes Markdown prompt sources, cooperative handoff, descendant costs, and background UX changes. Restart required for the running session to use the new build. Medium validation and minimal-reasoning limitations remain as documented above.

### Quiet startup and product-facing prompt

- Startup defaults to quiet mode: no Pi self-help promotion or loaded-resource inventory. Skill discovery and slash commands remain enabled; diagnostics remain visible. `--verbose` is still an explicit diagnostic override.
- Applies the supported `quietStartup` preference process-locally through a scoped SettingsManager presentation-getter adapter because Pi main() exposes no settings-injection option. User settings are not changed or persisted by this override.
- Removes only the upstream default internal-documentation block and uses the Markdown die identity. Explicit custom system prompts, appended instructions, and project context are preserved; model-facing SDK coverage checks repeated turns.
- Real-terminal validation passed: promotion/inventory hidden, skill autocomplete retained, warnings visible. Full validation: 166 passed, 10 opt-in skips, 956 assertions across 39 files; typecheck/build/smoke/diff checks passed. Built, not installed.

### Compaction/cache investigation

- Compared installed Pi 0.85.0, official Claude Code/Claude API docs, and Codex source pinned at 588b781ab4924ce7352488394028e63d74cf807f. Findings: `docs/compaction-research.md`.
- Three actual session compactions recorded 244,937 uncached input tokens, zero cache reads, and $2.96917 client-estimated cost. Offline Codex serializer capture (zero network/model calls) confirms changed summarizer instructions, flattened/truncated history, absent tool schemas and omitted cache identity.
- Claude Code explicitly documents a same-prefix summarization fork. Current Codex defaults to provider-native Responses compaction triggers on supported providers, with opaque output and provider-specific retained history; its ordinary local-summary fallback is distinct.
- Recommendation: prototype/cache-benchmark a prefix-preserving plaintext fork, then evaluate native provider compaction separately. Cache availability, write charges, overflow, summary/tail boundaries, live job facts and resumed-turn warm-up are required evaluation dimensions. No production changes or installation in this research task.

### Compaction implementation decision

- Agreed sequence: **Phase 1: Claude-style cache-affine plaintext compaction; Phase 2: Codex-native compaction.** Detailed scope and acceptance considerations: `docs/compaction-research.md`.
- Codex-native compaction is the required eventual strategy for the Codex provider, not merely an optional experiment. The user prioritizes its native compaction quality. Any interim portable path is not the final Codex design.
- Separate provider strategy from shared compaction lifecycle/checkpoint handling. Native output must retain its opaque item representation, with correct accounting and explicit resume/provider-switch behavior.
- Both phases remain unimplemented; this update records the approved direction only. No installation.

### Phase 1 compaction implementation in progress

- User authorized implementation of the Claude-style cache-affine plaintext path. Production implementation/focused tests are delegated to a normal worker; independent API/prefix-risk reconnaissance is delegated to fast.
- Root owns integration review, final validation and documentation. Codex-native Phase 2 remains deferred. No installation authorized.

- Initial Phase 1 review: seven isolated unit tests passed, but new root-owned actual SDK/provider-serializer tests exposed fallback on both Codex and Anthropic; these failures are retained as evidence rather than accepted as cache-affine success. Provider mapping/cache-marker handling is being corrected.
- Existing SIGTERM escalation test failed because its fixed 25ms delay could signal before the login shell installed the trap. Replaced that delay with a bounded readiness handshake; the original SIGKILL assertion remains. Focused task-manager suite now passes 18 tests.

### Phase 1 cache-affine compaction implemented

- Added native-prefix plaintext summarization through the compaction hook, imported Markdown prompts, provider-prefix/cache-policy checks, visible standard fallback, and safe cancellation after billable unusable responses. Runtime-owned running jobs are appended to the checkpoint; failed-response usage is retained in cost totals.
- Actual SDK/serializer tests cover Codex and Anthropic (including thinking mapping and routing headers); unit tests cover boundaries, transforms, overflow, failures, accounting and template safety. Final validation: 186 passed, 11 opt-in skips, 1,024 assertions across 42 files; typecheck/build/smoke/diff checks passed.
- Two single-run live probes demonstrated cache reuse and preservation of a value lost by the truncated baseline. The strengthened probe also verifies tail exclusion and correct resumed recall: 9,728 cached / 1,259 uncached summary input tokens (~88.5% cached). It cost ~30% more than its much shorter baseline; no universal savings claim. Evidence and limitations: `docs/compaction-research.md`.
- Some automatic between-tool compactions and unsupported/stale contexts still use the standard path rather than bypassing context transforms. Native Codex Phase 2 remains deferred and required. Built, not installed.

### Phase 2 native Codex compaction in progress

- User authorized implementation and testing of the deferred native Codex path. A normal worker owns production implementation/focused tests; fast provides repository-specific reconnaissance. Root owns independent SDK/resume/live validation and integration review.
- Acceptance requires native opaque state, durable checkpoint/resume, no duplicate retained history, correct usage accounting, cancellation/failure preservation, and explicit unsupported-provider behavior. Plaintext fallback must never be presented as native success.
- No installation authorized.

### Native Codex compaction implemented (compaction Phase 2)

- Production Codex now prefers the actual Responses remote-V2 compaction trigger, not plaintext. Versioned opaque items survive checkpoint, JSONL reopen and repeated compaction through a scoped, serializer-tested compatibility adapter. Other providers retain Phase 1.
- Preserved normal request/cache identity, registry OAuth/account/routing headers, original history and Pi's retained-tail boundary. Every discarded message must be covered. Runtime-owned job facts remain deterministic; no restart-survival claim is made.
- Incompatible provider/model use, invalid native metadata, lost serialized opaque items and lossy branch summaries fail closed. Thinking changes are allowed. Custom/stale compaction cannot flatten existing opaque state. Branching without a summary remains available.
- Native output is bounded and validated; cancellation never dispatches tools or silently starts a second paid inference. Available failed/cancelled usage uses the existing footer/descendant accounting path.
- Root review corrected missing native auth, initially fail-open provider switching, stale/discarded-history coverage and failed-usage accounting. Independent SDK tests cover real disk reload, both Codex-model and foreign-provider guards, repeated compaction, preserved state on failures and actual transport abort/size bounds.
- First live probe retained: native compaction and recall passed, but repeat preflight failed because the fixture was too small. The enlarged repeat fixture passed once: native-live-1788628612135.json. First native checkpoint read 7,680 cached / 711 uncached tokens (~91.5%), cost estimate $0.00040740; disk-resumed recall was correct; repeated native compaction also passed. No comparative savings or universal quality claim.
- Scope limits: retains Pi's tail policy, not Codex's separate 64k client policy; provider/model switching requires branching before a native checkpoint or starting anew; fresh-resume compaction may need an ordinary request first. Immediate token estimates cannot inspect encrypted state. See docs/compaction-research.md.
- Final validation: 213 tests passed, 12 opt-in skips, 1,144 assertions across 47 files; typecheck, build and smoke passed. The native live probe passed separately. No installation authorized or performed; the installed binary is still older than quiet-startup and compaction changes.

### Current-conversation plaintext compaction revision in progress

- User approved replacing stale-request eligibility with current-conversation preparation through the ordinary framing/context/provider pipeline. Old captures should measure cache affinity, not gate the strategy.
- Native Codex remains unchanged. Root is independently testing fresh preparation, newly arrived tool results, context redaction/boundary changes, prompt/header fidelity and single-inference behavior. No installation authorized for this revision.

### Current-conversation plaintext compaction implemented

- Removed the old captured-request eligibility gate and captured-history production fallback. Non-Codex compaction prepares current history through ordinary framing/context/conversion/tools/auth/header/payload/response hooks. Captures only diagnose prefix affinity. Native Codex behavior is unchanged.
- Fresh disk resume and uncaptured tool results work. Warm framing is reused rather than replaying before_agent_start side effects. Changed/redacted prefixes no longer force another strategy.
- If transforms obscure the retained boundary, summarize the whole processed conversation while retaining Pi's durable tail. This favors completeness over silently excluding discarded facts. Scope prose remains editable Markdown.
- Preparation/capacity failures cancel instead of flattening unprocessed data through a fallback. Available failed usage remains accounted, and no alternate hidden inference is made. The owning-session adapter is a pinned classic Pi compatibility seam; missing support is visible.
- Independent SDK cases and both live probes passed. Current-live-1788632956201.json verified fresh resume, redaction and new tool facts with no cache reads. Live-1788633062301.json verified 9,728 cached / 1,089 uncached tokens, fact retention and resumed recall; no savings versus the shorter information-losing baseline were demonstrated.
- The user confirmed installing/restarting the prior native-compaction build before this revision. This new revision has NOT been installed. Final validation passed: 222 tests, 13 opt-in skips, 1,270 assertions across 49 files; typecheck/build/smoke passed. Both plaintext live probes passed separately.

### Stranded-worker finding (2026-09-05 21:40 UTC)

User-requested inspection found both final hardening workers had emitted final reports at 20:12/20:16 UTC but their processes remained alive in epoll wait for over 80 minutes. Root had mistaken running status for ongoing work. Their reports claim 33 framing/compaction tests and 21 compiled runner tests passed; integration must verify independently. Session-owned jobs were explicitly stopped after retaining logs. This exposes an additional print-worker exit/completion lifecycle bug to diagnose; automatic completion cannot be assumed from final assistant text alone.

Follow-up: both workers had exactly one uncompleted initial discovery job containing `ls`. Re-running both original commands reproduced the stall; process inspection identified the configured fish `ls` alias (`eza -al --color=always --group-directories-first --icons`) blocked in `unix_stream_read_generic`. Bounded diagnostic probes timed out and were cleaned up. Therefore the evidence does **not** establish a worker exit/notification leak: print mode was waiting for real managed work. Root’s missed inspection and misleading “receiving model response” progress remain actionable observations. Do not impose arbitrary job deadlines or treat final prose as process completion.

Integrated deterministic gate: 245 passed, 13 opt-in skips, zero failures, 1,369 assertions; typecheck, compiled build, standalone smoke and diff check passed. Logs: `/tmp/die-hardening-final.log`. Live medium UX and native/current compaction checks are pending. Nothing installed.

Root cause of discovery stalls confirmed by strace: `eza` blocks in `read(0, ...)`, because the shell helper intentionally keeps stdin open. An EOF probe exits immediately (with no listing: eza interprets piped stdin as filename input). Use explicit directory arguments/native listing or filesystem APIs for discovery; do not silently change shell stdin semantics. Agent progress now distinguishes “assistant turn finished” from “receiving model response”, without claiming process completion.

Live hardening evidence: medium nested/TUI/Escape passed 3/3 (leaf launch 912 ms for 15,006 ms job); current-conversation compaction passed. Native probe failed with invalid opaque item set (`artifacts/compaction/native-live-1788644689173.json`). Root found the tightened final-output rule excluded the previously supported streamed-item plus empty terminal-output representation. Added regression retaining exact-one-item checks and restored that representation; a changed-code native probe is running, not a retry of unchanged code for a lucky pass.

Corrected native probe passed once after restoring the stream-only terminal representation: `artifacts/compaction/native-live-1788644823201.json` (checkpoint, disk-resume recall and repeat). Failed first probe remains retained. Final gate is being repeated after the new progress label and immediate prepared-frame/SDK-override synchronization; a test fixture literal typing error stopped v2 before build and was corrected, with the failed log retained.

### Hardening acceptance (2026-09-05)

Final integrated gate passed: **247 tests, 13 opt-in skips, zero failures, 1,377 assertions**, plus typecheck, compiled build, standalone smoke and diff check (`/tmp/die-hardening-final-v3.log`). The live medium nested/TUI/Escape batch passed 3/3; current-conversation compaction passed; native compaction passed after the documented stream-only protocol correction. The final override-synchronization and progress-label amendments are covered by the final deterministic gate; no universal reasoning-level, provider-cache or savings claims are added. All four reviewed bugs and Markdown-description extraction are fixed. Current `dist/die` is built, not installed. `/ps`, main-agent mode switching and persistent execute remain separate deferred work.

## Repository publication (2026-09-05)

User authorized committing and publishing the accumulated implementation, tests, prompts and product documentation to `git@github.com:tnfssc/die.git`. Publish the existing `develop` branch without rewriting history. Generated binaries, dependencies, local runtime/session data and ignored test artifacts remain excluded; their validation results and paths are documented above. Goal mode, attention checkpoints and the footer cache countdown remain planned, not implemented. Publication does not authorize a local installation.

## Delegated feature rollout (2026-09-05)

User authorized implementation of all five planned features, `/resume` styling/safeguards, GitHub CI and tag-triggered releases, contributor documentation and an MIT license. User additionally requested codebase-structure review and appropriate lint/format tooling. Root acts as orchestrator/reviewer, delegates implementation in isolated worktrees, integrates verified changes and pushes incremental milestones to `develop`. No local installation or release tag creation is authorized by this work.

- [ ] Job attention scheduling and agent wakeups (`feature/job-attention`).
- [ ] Configurable per-agent cache countdown (`feature/cache-countdown`).
- [ ] `/ps` monitor and deliberate child-session `/resume` selection (`feature/task-monitor`).
- [ ] Durable opt-in goal mode and safe continuation (`feature/goal-mode`).
- [ ] Main-agent instruction modes (`feature/main-agent-modes`).
- [ ] CI, tag-release workflow, contributor README and MIT license (`feature/project-release`).
- [ ] Independent structural review, scoped cleanup and lint/format gates.
- [ ] Cross-feature lifecycle tests, resource/stress tests, real-terminal/model validation and final remote publication.

Integration decisions: main-agent modes change behavioral instructions only, preserving existing root delegation permissions and model/thinking selection. Initial release binaries target the supported Linux x64 baseline; other platforms are not claimed without corresponding validation. Shared attention/goal completion boundaries require explicit review for duplicate wakeups, user interruption and waiting-state behavior. Formatter changes should be isolated after feature integration rather than obscure parallel semantic diffs. All feature workers use separate build outputs and treat shared development dependencies as read-only.

Architecture review: the main maintenance risks are dense formatting in provider/bridge code and the shared Pi instruction/session adapter being housed inside plaintext compaction. Root treats these as targeted cleanup opportunities, not proof of new runtime bugs. Add pinned Biome tooling now; apply mechanical formatting in a separate post-integration commit, then extract the shared compatibility boundary with behavior-preserving tests. Avoid broad task-manager/ACK redesign or automatically uninstalling a process-wide adapter on one session reload while other sessions are live.

Tooling milestone: merged exact-pinned Biome 2.5.12 configuration and scripts after independently checking frozen dependency installation, lint and TypeScript. Existing formatting debt is explicitly documented (74 baseline diagnostics); formatting is not yet enabled as a required CI gate. Lint preserves recommended correctness checks with documented baseline warnings rather than disabling all rules. No production dependency upgrades or local die installation.

First feature-review pass retained green-test counterexamples rather than accepting isolated suites: `/ps` confirmation could target a different job after list mutation; resume decoration used unbounded concurrent metadata reads; attention scanned every job on every activity event and risked releasing print mode before debounced delivery; goal progress counted control-only/failed tools and lacked branch-safe restoration; cache settings risked overwriting unrelated configuration and header preparation was not actual dispatch; mode replacement could match user/project marker text. Release review caught missing fresh-checkout build ordering and hardcoded future-version checks. Workers are adding regressions and corrections before feature acceptance.

Accepted integration milestone: merged the task monitor/resume safeguards and CI/release/contributor/license branches. Root independently ran lint, typecheck, build, smoke, attribution generation (134 production packages), and the combined full suite: 268 passed, 13 environment-gated skipped, zero failures. A subsequent adapter-composition correction preserves foreign wrappers across shutdown/reinstall and validates role metadata; focused resume, real terminal monitor, and release tests passed after a fresh build. Generated artifacts remain ignored; no installation, release tag, or publication was performed.

Further review retained additional counterexamples before remaining feature acceptance: Codex auto/WebSocket calls bypass HTTP response hooks; random mode ownership markers broke resumed prompt byte stability; child environment roles needed a cap independent of depth; goal waiting/context updates must cover custom completion turns, not only ordinary user turns; repeated print attention checkpoints must not accumulate losing per-job promise handlers. Delegated corrections and cross-feature integration are ongoing.

Second accepted integration milestone: cache countdown, main-agent instruction modes, and job attention are merged alongside monitor/resume and release tooling. Root independently validated lint, typecheck, fresh build, smoke, and the full deterministic/SDK/TUI suite: 316 passed, 13 environment-gated skipped, zero failures (1,731 assertions). The print attention and bounded coalescing windows now use disposable completion subscriptions instead of accumulating unresolved per-job promise handlers. The shared instruction/session continuity adapter was extracted into `src/tasks/instruction-continuity.ts` with compatibility reexports and focused regression validation; private Pi version coupling remains explicit. Goal mode and the formatter-only pass are still pending; natural/live-model validation of this combined feature set has not yet run. GitHub CI passed the previous published monitor/release milestone.

Final integration gate so far: root independently ran format check, lint, typecheck, deterministic/SDK/TUI tests and smoke after the formatter-only integration: 342 passed, 14 gated skips, zero failures, 1,840 assertions across 65 files. The Linux x64 baseline release binary built and reported the package version; production attribution generation covered 134 packages. No tag/publication/install was performed. Six live regression probes passed once on this feature set: medium nested/TUI/Escape (leaf launch returned in 927 ms for a 15,005 ms job), warm plaintext compaction, native checkpoint/resume, and fresh current-context compaction. Evidence: `/tmp/die-final-live-regressions.log`, `artifacts/ux/nested-1788651815740.json`, and compaction artifacts ending `1788651870249`, `1788651889331`, `1788651896891`. These results do not generalize to minimal reasoning or establish universal provider/cache savings.

The newly added live goal smoke failed on its first run before its criterion file existed. Its captured assistant result was an error with zero reported usage, but the fixture omitted the underlying error message; cause investigation and an offline setup regression are pending. Failure is retained at `artifacts/goals/live-1788652005874.json` and `/tmp/die-final-goal-live.log`. Goal lifecycle deterministic/real-SDK tests passed, but natural goal completion is not yet validated.

Final validated result: 343 passed, 14 gated skips, zero failures, 1,848 assertions across 65 files; format check (119 supported files), recommended lint, typecheck, fresh compiled build and smoke all passed. The instrumented live goal smoke then passed once on Codex gpt-5.6-luna with medium reasoning over SSE, using four concrete provider dispatches; it verified the exact temporary criterion bytes and durable completed-goal evidence. Artifact: `artifacts/goals/live-1788652471171.json`; log: `/tmp/die-goal-live-instrumented.log`. The first goal failure remains unexplained: offline real-SDK interception disproved the uninitialized-catalog hypothesis, and the old fixture did not capture the underlying error. Observability, dispatch-budget accounting and readiness handling were corrected before the instrumented run; this is not an unchanged retry or a universal goal-quality claim. All five requested features, resume safeguards, release/CI tooling, MIT attribution, contributor documentation, formatting gates and the shared instruction adapter extraction are now integrated. No local installation or actual release tag/publication was performed.

Release follow-up (2026-09-06): user explicitly authorized publishing v0.1.0 after the reliability investigation. Actual-SDK offline reproduction now distinguishes an unconfigured-auth failure (one runtime invocation, zero provider dispatches, zero usage) from a provider request; this is a proven possible failure path, not proof of the original discarded error. Live fixtures now preflight authentication with a five-minute OAuth validity margin. Root verified format, lint, typecheck, build, smoke and 346 passing tests / 14 gated skips / zero failures (1,856 assertions). The earlier image/fake-clock flakes were not reproduced; repeated green runs do not establish their original cause. The old local-only signed v0.1.0 baseline tag will be preserved under an archive ref before the current validated release tag is published. Local installation remains unauthorized.

UI direction (2026-09-06): user requested collapsing execute tool displays and task-completion notifications to a single line by default. Preserve expandable command/output/details and visible failure indicators. This is recorded as pending implementation; example labels are illustrative, not a finalized rendering contract.

Claude workflow research (2026-09-06): user requested deep research via tvly. The authenticated research endpoint was unavailable; advanced search/extraction identified the actual Claude Code Dynamic Workflows feature. Findings and source links are in `docs/claude-workflows-research.md`. Existing execute/subagent primitives can express bounded scripted orchestration, but are not equivalent to session-owned workflow execution, structured final-result calls, or ordered persisted replay. No new workflow/prompt API is authorized or implemented by this research.

Release status: v0.1.0 is published at https://github.com/tnfssc/die/releases/tag/v0.1.0; downloaded Linux x64 checksum and version were verified. Release workflow and tag CI passed. Separate branch CI exposed a 200 ms job-startup assumption; the post-release test now synchronizes cancellation to an actual spawn and deliberately delays startup. Root full-suite validation passed; the published tag remains unchanged.

Single-line UI implementation verified (2026-09-06): collapsed execute call/result presentation occupies one row, as do completion/attention messages. Expansion preserves command, full retained output and handoff text; model-visible content and job ownership are unchanged. Failure/attention indicators precede truncatable descriptions; full-batch status aggregates preserve failures beyond the 50-task detail bound, and unknown legacy status is not shown as success. Loss/image/background metadata is kept before long command text. Real PTY coverage includes expansion, failure and 38-column rendering. Root first full gate retained two failures: an obsolete collapsed-handoff assertion and a goal TUI startup race. Assertions now distinguish collapsed/expanded/model-visible content, and the TUI waits for a successfully handled non-LLM status command. Final root gate: format, lint, typecheck, build, smoke and 354 tests passed, 14 gated skips, zero failures (1,938 assertions). Logs: `/tmp/die-single-line-tests.log` and `/tmp/die-single-line-final-tests.log`. This update is for develop; the published v0.1.0 tag and local installation remain unchanged.

Prompt icon decision: restore the minimal Nerd Font chevron `` (`nf-oct-chevron_right`, U+F460) for idle input; retain the existing animated loading indicator while working, sharing a stable gutter. Reserve `` (`nf-fa-bolt`, U+F0E7) for future provider-native fast mode, not a generic working indicator. Track native fast-mode support as planned research/implementation: verify supported Codex/OpenAI and Anthropic models, API settings, availability, pricing and semantics before claiming support. This is distinct from `/mode fast` (instruction-only) and fast worker profiles; provider-native fast mode is not implemented by this icon change.

Idle chevron implemented and reviewed: `` replaces the idle empty gutter, and the existing spinner uses the same two-column slot while working. Very narrow editors prioritize input; scroll indicators, mouse offsets and autocomplete alignment remain covered. Root format/typecheck/build/full tests/smoke passed; offline PTY coverage confirms the glyph in startup output. Native fast mode remains a future item, not implemented.

Herdr integration implemented: built-in `src/herdr-agent-state.ts` adapts the managed Pi v6 protocol without editing or loading `~/.pi/agent/extensions/herdr-agent-state.ts`. Enabled only for a root interactive Herdr pane; child roles/depth and non-UI sessions excluded. Uses source `herdr:die` with compatible agent identity `pi` because installed Herdr 0.7.5 has no verified native die display identity. Root review corrected wire sequencing, bounded awaited quit release, stale replacement queues/transports and blocked-listener reattachment. Real Unix-socket tests cover lifecycle and unavailable endpoints; full root format/lint/typecheck/build/tests/smoke passed (log `/tmp/die-herdr-tests.log`). Background jobs alone do not force working status; lifecycle follows the actual agent loop. See `docs/herdr.md`. Native fast-mode implementation remains under review in its own worktree; workflow result contracts are scoped but not yet implemented.

Native fast-mode initial implementation verified: `/fast` and `/fast status` are read-only; `/fast on` requires premium-cost consent (TUI confirmation or explicit `--accept-cost`), and `/fast off` pins the official supported surface to standard/default. Exact OpenAI/Codex provider/model/endpoint/auth allowlists and active-branch, session/model-bound authorization leave model/thinking unchanged and do not authorize child sessions. `` footer reports requested, never inferred confirmation; fast-session cost totals are unavailable (`$?`) rather than misleading SDK standard-tier estimates. Anthropic adapter and actual tier/cost reporting remain deferred. See `docs/native-fast-mode.md` for source pins and limitations.

Native fast-mode root review caught swallowed extension-hook guards, stale consent, corrupt-record fallback, mutable UI-model request races, and unsupported cost/confirmation claims. Corrected implementation snapshots authorization at the concrete per-runtime Pi 0.85 request seam, injects before existing payload hooks and validates after them; real SDK tests prove zero dispatch for rejected authorization/tampering and preserve delayed-request identity. Compaction explicitly uses standard tier with async-local isolation. Initial root integration gate retained a formatter failure and five incomplete-context fixture failures (`/tmp/die-fast-final-tests.log`); fixture updates retain identity/execute-only assertions and verify quiet unconfigured startup. Final root format/lint/typecheck/build/smoke and full test gate passed: 379 pass, 14 gated skips, zero failures, 2,044 assertions (`/tmp/die-fast-verified-tests.log`). No paid fast-mode request or provider latency/billing validation was performed; this is offline/SDK validation, not a live performance claim. No local installation, release, or published-tag change.
