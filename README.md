# die

`die` is a Bun-compiled coding agent built on [Pi](https://pi.dev). It packages Pi as a standalone executable and replaces model-facing shell execution with an asynchronous task primitive. The single TypeScript execution tool remains planned for Phase 3; see [`PRODUCT.md`](./PRODUCT.md).

## Prerequisites

- Bun 1.3 or newer (build time only)

## Build

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

The executable is written to `dist/die`.

## Install locally

```sh
bun run install:local
```

This builds and atomically installs the executable to `~/.local/bin/die`. If that directory is not already on `PATH`, the installer prints a reminder. Set `DIE_INSTALL_DIR` to override the destination.

```sh
die --help
die
```

The compiled executable includes its runtime and can be copied to another location on a compatible OS/architecture. API credentials and user configuration are still supplied at runtime as they are for Pi. `die` stores its configuration and persistent state under `~/.die` rather than `~/.pi`. Automatic update checks and the `die update` command are disabled until `die` has its own update channel.

## Tests

```sh
bun run test         # Build, CLI, configuration, and TUI harness tests
bun run smoke         # Standalone shell smoke test
bun run test:llm      # Authenticated GPT-5.6 Luna test (incurs an LLM request)
```

The automated suite verifies the compiled executable in an isolated home directory and uses a private tmux socket for TUI tests. LLM tests always use `openai-codex/gpt-5.6-luna` and are opt-in so ordinary local checks remain deterministic.

## Asynchronous tasks

The model receives one `task` tool in place of Pi's `bash`/`powershell` tools. It can:

- Spawn one command or multiple separately managed concurrent commands in a batch
- Delegate one prompt or multiple concurrent prompts through the higher-level `subagent` tool
- Manage sub-agents by task ID through `task list`, `task inspect`, and `task kill`
- Inherit the parent model and thinking level for sub-agents unless explicitly overridden
- Keep sub-agents as leaves: they retain `task` but cannot spawn additional sub-agents
- Batch burst completions into a single model/TUI notification capped at 5,000 characters
- Inspect retained completed-task output when a notification contains only previews
- List running or completed tasks through bounded, paginated command previews without changing the commands themselves
- Inspect tasks and read output incrementally with byte cursors that preserve UTF-8 character boundaries
- Retain only the latest 1 MB per task using a chunked bounded buffer
- Write to or close a task's standard input
- Terminate tasks
- Continue other work until an automatic completion message arrives

Tasks are currently scoped to one session and are terminated when that session shuts down.

## Interactive TUI harness

The harness runs `die` in a detached tmux pseudo-terminal. It defaults LLM sessions to `openai-codex/gpt-5.6-luna` and records artifacts under `artifacts/tui/`.

```sh
bun run tui start demo
bun run tui frame demo
bun run tui send demo "Reply with a short greeting"
bun run tui followup demo "Now reply with one word"
bun run tui history demo
bun run tui record demo 5 250
bun run tui key demo Escape
bun run tui stop demo
```

Each session gets a continuous ANSI transcript plus initial/final frame captures. `record` saves timestamped ANSI frames at the requested interval, making intermediate TUI states inspectable. The session named `demo` is automatically killed after 60 minutes; other sessions have no automatic timeout. Use `bun run tui --help` for the command reference.

## Cross-compilation

Pass a Bun compile target when producing release artifacts, for example:

```sh
bun build --compile --target=bun-linux-x64 ./src/cli.ts --outfile ./dist/die-linux-x64
```

See [`PRODUCT.md`](./PRODUCT.md) for the product direction and phase acceptance criteria.
