# die — Product Reference

> This document records the product direction and decisions stated by the user in this project conversation. Those statements are the source of truth. Implementation details may support them, but must not silently become product requirements.

## Identity and foundation

- The product and executable are named lowercase `die`.
- `die` is a CLI coding agent built from Pi. Whether this is described as a fork or a packaged version is unimportant; Pi runs underneath it.
- Bun compile produces a standalone binary so using the resulting CLI does not require a separate Bun, Node.js, Pi, or project dependency installation.
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
- The model-facing generic task operations are `spawn`, `list`, `inspect`, `input`, and `kill`.
- Spawn responses include task IDs.
- A completed task remains inspectable for the rest of the current session. Because retained results are inspectable, completion overflow does not need to be written to a file.
- Task output is buffered without rendering every output chunk. Retention is bounded per task and implemented to avoid repeated whole-buffer copying.
- Aggregate session memory and global concurrency limits are not required at this stage.
- The command task intentionally uses the user's configured shell. Shell-specific behavior is expected.
- Session shutdown terminates running task process groups and escalates termination when necessary.

### Completion delivery

- Completion notifications arriving in bursts are batched before delivery to the model.
- A completion notification is limited to 5,000 characters.
- The notification provides previews; full retained output remains available through task inspection.
- Task IDs for completion blocks omitted from the preview are included compactly when they fit within the same limit, with `task list` available to recover all IDs.

### Listing and inspection

- `task list` must not produce unbounded model-context output. It is paginated and displays bounded command previews; the exact preview presentation is an implementation choice that should remain understandable and must never alter execution.
- Commands are always executed in full. Display shortening applies only to presentation.
- Inspection uses cursors and preserves UTF-8 characters at page boundaries.
- Standard output and standard error are currently merged. Separating and labeling them is deferred and should remain noted in the code.

### Sub-agents

- `subagent` is a specialized capability built on top of the generic asynchronous task system.
- It launches isolated background `die` agents and returns their task IDs immediately.
- The parent manages them through the generic task lifecycle and receives automatic completion notifications.
- Sub-agents inherit the parent's model and thinking level by default, with overrides available when requested.
- A sub-agent can use normal coding capabilities and generic asynchronous command tasks.
- Sub-agents are leaf agents: they do not receive the model-facing `subagent` capability and cannot use it to recursively spawn additional sub-agents.
- The leaf rule is functional behavior, not a security boundary against a process deliberately modifying its environment and invoking executables itself.

### Tool selection

- `task` is a core capability, and `subagent` is a core capability for root agents.
- Pi's model-facing `bash` and `powershell` tools are disabled in favor of `task`.
- Generic Pi options intended to disable or select model-facing tools are removed from `die`; they must not override the core `die` tool model.
- Other file tools remain until Phase 3.

## Phase 3 — One TypeScript execution tool

- Remove the model-facing `read`, `edit`, `write`, and shell tools.
- Replace them with exactly one model-facing tool that accepts and executes TypeScript.
- The model performs reads, writes, edits, and command execution by writing TypeScript for this tool.
- The tool executes the submitted TypeScript and returns its output or result.
- TypeScript is the initial language.
- Phase 3 begins only after Phase 2 is accepted.

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

## Current phase

Phase 1 is established. Phase 2 is the current implementation scope. Phase 3 has not started.
