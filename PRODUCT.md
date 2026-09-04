# die — Product Reference

> This document is the canonical reference for product intent. Update it when product decisions change so implementation and expectations can be reconciled against the same source.

## Product identity

- **Product name:** `die`
- **Executable name:** `die`
- `die` is based on Pi (the Pi coding agent). Whether it is maintained as a source fork or as a packaged distribution is an implementation choice; preserving the intended behavior matters more than that label.
- `die` is a terminal/CLI coding agent. Pi runs under the hood and provides the initial agent, model, session, and terminal experience.

## Configuration

- `die` uses `~/.die` as its configuration and application-data directory.
- It must not use Pi's `~/.pi` directory by default.
- Settings, credentials, sessions, extensions, and other persistent `die` state live beneath `~/.die`.

## Testing

- Use `openai-codex/gpt-5.6-luna` for all tests that require an LLM unless this decision is changed explicitly.
- Keep non-LLM build and smoke tests local and deterministic; do not add unnecessary model calls where no LLM behavior is under test.
- Build, standalone CLI, configuration isolation, update disabling, TUI harness, demo timeout, and optional authenticated LLM behavior are covered by a repeatable automated test suite.
- Interactive testing must run `die` in a real pseudo-terminal so tests exercise the same TUI a user sees.
- The interactive test harness should support visible-frame capture, full-history inspection, continuous terminal transcripts, timed frame recording, steering messages, queued follow-up messages, arbitrary key input, and clean session shutdown.
- The interactive harness session named `demo` automatically terminates after 60 minutes so an abandoned demo cannot run indefinitely. Other interactive sessions do not receive this automatic timeout.

## Product direction

Development is split into three sequential phases.

### Phase 1 — Portable compiled CLI

Produce a native executable with Bun's compile functionality (`bun build --compile`). The executable launches Pi under the hood and behaves as a CLI agent. `die` is the product—not merely the name of a wrapper command—while Pi is its underlying foundation.

Goals:

- The output is a binary named `die`.
- A user can invoke the binary directly without separately installing Node.js, Bun, Pi, or project dependencies.
- The initial version should preserve Pi's existing CLI behavior unless `die` explicitly changes it in a later phase.
- Start implementation here before working on phases 2 or 3.

Interpretation note: “run anywhere” means a self-contained executable for its compiled target OS and architecture. Separate build artifacts may be required for different OS/architecture targets. External programs deliberately invoked by the agent are not bundled into the executable.

### Phase 2 — Asynchronous tasks (“asynchronous agents”)

Replace Pi's current shell-oriented execution model with an asynchronous task primitive. A task may represent a command, a sub-agent, or another long-running unit of work.

Required lifecycle and behavior:

- **Spawn:** the agent can start a task without blocking its own loop until the task exits.
- **Inspect:** the agent can query task state and observe available output.
- **Interact:** where applicable, the agent can send input through standard input or an equivalent interaction channel.
- **Notify:** when a task completes, the agent is notified automatically.
- **Continue concurrently:** while a task runs in the background, the agent remains free to call tools, start or manage other tasks, reason, and perform other work.

The conceptual model is similar to the JavaScript event loop: work proceeds independently and completion is delivered back as an event. “Asynchronous agents” is the current product term, even though the primitive must support both sub-agents and ordinary commands.

Initial Phase 2 implementation decisions:

- The model-facing `task` primitive provides `spawn`, `list`, `inspect`, `input`, and `kill` actions for generic asynchronous work.
- A model-facing `subagent` capability is implemented on top of the task primitive. It delegates prompts to isolated background `die` agents, immediately returns their task IDs, and relies on `task` for inspection and lifecycle management.
- `task spawn` supports shell-command tasks. Up to 100 independent commands can be batch-spawned as separately managed concurrent tasks in one tool call.
- `subagent` can launch one agent or up to 8 independent agents concurrently. Sub-agents inherit the parent model and thinking level by default, with optional overrides.
- Sub-agents are leaf agents: `subagent` is removed from their active tools, and invocation is also rejected at execution time. This prevents recursive agent spawning. They retain `task` for ordinary asynchronous work.
- Spawn returns immediately with a unique task ID and process ID for each task.
- Completion injects a visible task-completion message into model context and triggers or steers the next agent turn automatically. Bursts are debounced and batched into one notification, with a maximum wait to prevent starvation.
- A completion notification is capped at 5,000 characters. It contains task/output previews, compactly lists task IDs for completion blocks omitted by the preview when they fit, and directs the agent to `task inspect` or `task list` for retained details.
- `task list` is paginated (50 tasks by default, at most 100 per page), uses a task-index cursor, and truncates displayed commands to keep tool responses bounded.
- Output can be inspected incrementally using byte cursors. Each inspection is capped at 50,000 bytes; page boundaries preserve complete UTF-8 characters. Each task retains the most recent 1,000,000 bytes in a chunked bounded buffer.
- Standard input can be written or closed for running command tasks.
- Timeouts are optional per task, followed by process-group termination.
- Task termination sends `SIGTERM` to the process group and escalates to `SIGKILL` after a grace period. Session shutdown uses the same escalation so resistant background processes are not abandoned.
- Tasks are currently session-scoped, held in memory, and terminated during session shutdown. Persistence across sessions or process restarts is deferred.
- Pi's model-facing `bash` and `powershell` tools are disabled in favor of `task`; the other built-in tools remain until Phase 3.
- `die` intentionally keeps `task` active and keeps `subagent` active for root agents. Pi's generic tool-selection flags (`--no-tools`, `--tools`, and `--exclude-tools`) are not a product requirement for disabling these core capabilities and may be removed rather than supported.
- Command tasks intentionally use the user's configured login shell through `$SHELL -lc` (or the platform command interpreter on Windows). Shell-specific behavior is expected rather than normalized.
- Retained output is bounded per task but not across the whole session. A global output-memory budget, task-record limit, and global concurrency limit are intentionally not required at this stage.
- Standard output and standard error are currently merged into one retained stream. Distinguishing them is deferred and noted in the implementation.
- Eight-hex-character task IDs remain acceptable; expanding them is not planned.
- The leaf-subagent marker prevents normal recursive use of the model-facing capability but is not intended to be a security boundary against a process deliberately changing its environment and launching `die` itself.
- Additional authenticated LLM coverage specifically for the recursion guard is not required; deterministic tests and the completed real-TUI validation are sufficient.

Further design work may revisit durable tasks, output spooling, completed-task retention, richer task rendering, and separated stdout/stderr. Global memory and concurrency limits are not currently planned.

### Phase 3 — One TypeScript execution tool

Remove the model-facing `read`, `edit`, `write`, and `bash` tools. Replace them with exactly one model-facing tool that accepts and executes TypeScript.

Required behavior:

- The model writes TypeScript and submits it to the execution tool.
- The tool executes that code and returns its output/result.
- File reads are implemented by submitted TypeScript.
- File writes are implemented by submitted TypeScript.
- File edits are implemented by submitted TypeScript.
- Command execution is implemented by submitted TypeScript.
- TypeScript, rather than JavaScript, is the initial supported language.

This is a capability consolidation, not a reduction: filesystem and process operations remain possible, but are expressed as code through one primitive rather than separate purpose-built tools.

Open design details to resolve during this phase include the execution API, available globals/imports, result serialization, stdout/stderr capture, timeout/cancellation behavior, permissions or sandboxing, module resolution, type checking versus transpile-only execution, and integration with phase 2 tasks.

## Disk-write policy

- Features added by `die` should avoid disk writes unless persistence or file materialization is necessary for the requested behavior.
- Pi's normal settings, credential, session, and application-state writes are acceptable.
- Embedded runtime assets required by the standalone executable may be materialized beneath `~/.die`, but immutable assets must be created only when absent and must not be rewritten on every launch.
- Asynchronous tasks, completion batching, retained task output, and sub-agent bookkeeping remain in memory for the session and do not add persistent files.

## Project maintenance

- The source tree is maintained in Git so implementation changes have history and can be reviewed or rolled back.

## Sequence and current scope

1. Build the portable Bun-compiled `die` CLI.
2. Add asynchronous task support.
3. Consolidate model-facing operations into one TypeScript execution tool.

**Current implementation scope: Phase 2.** Phase 1 established the compiled and tested packaging boundary. Phase 2 now provides the initial asynchronous task primitive; Phase 3 has not started.

## Acceptance criteria for Phase 1

- `bun run build` produces `dist/die`.
- `dist/die --version` exits successfully.
- `dist/die --help` exposes the underlying agent CLI.
- The executable can be copied outside the repository and still launch without a Bun or Node.js installation.
- Automatic update checks, update notifications, and the `die update` command are disabled until `die` has its own update channel.
- Pi is version-pinned so builds are reproducible and upgrades are deliberate.
- The repository documents build and smoke-test commands.
- `bun run install:local` builds `die` and installs it as `~/.local/bin/die` so it can be invoked from the terminal.

## Non-goals for Phase 1

- Asynchronous task management.
- Sub-agent orchestration.
- Replacing Pi's built-in tools.
- Final decisions for security/sandboxing.
- Guaranteeing one binary runs across incompatible operating systems or CPU architectures.
