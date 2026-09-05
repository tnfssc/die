# Contributing to die

Thanks for helping improve die. Small, focused changes with tests and clear commit
messages are easiest to review.

## Set up a development checkout

1. Fork the repository, then clone your fork and enter the checkout:

   ```sh
   git clone https://github.com/YOUR-ACCOUNT/die.git
   cd die
   ```

2. Install [Bun 1.4.1](https://bun.sh/) and restore the exact lockfile:

   ```sh
   bun install --frozen-lockfile
   ```

3. Run the deterministic checks:

   ```sh
   bun run check
   bun run build
   bun test ./tests
   bun run smoke
   ```

Do not commit generated `dist/`, `runtime-assets/`, test artifacts, credentials,
or local configuration.

## Test policy

The normal test suite is deterministic and must not require credentials or a paid
model. Tests that make real model requests are guarded by
`DIE_RUN_LLM_TESTS=1`; they are opt-in, may incur provider charges, and are not
run by CI. Do not enable them unless you understand the cost and have configured
your own provider credentials. Prefer pure tests and offline SDK fixtures. Use the
real TUI harness when terminal behavior itself is under test, and keep diagnostics
bounded so failures remain readable.

## Architecture

- `src/cli.ts` owns startup, the standalone runtime, and Pi integration.
- `src/typescript/` implements the single `execute` tool and its process/job bridge.
- `src/tasks/` implements durable jobs, sub-agents, completion delivery, and
  persisted session diagnostics.
- `src/ui/` contains TUI behavior.
- `src/prompts/*.md` are the source prompts imported by `src/prompts.ts`.
  Edit the Markdown sources rather than generated representations, and preserve
  explicit custom prompts and instruction continuity.
- `scripts/prepare-assets.ts` copies the Pi runtime assets embedded by the build.
  Preserve upstream license banners and update `THIRD_PARTY_NOTICES.md` when the
  packaged asset set or licensing changes.

Background operations are session-owned: avoid changes that accidentally terminate
jobs when an execute worker exits. Keep history durable, handoffs cooperative, and
failure diagnostics bounded.

## Documentation and pull requests

Documentation-only edits can be checked directly in Markdown; verify links, command
names, and claims against the current source. Do not describe planned work as
implemented. Before opening a pull request, run the deterministic commands above
and summarize what changed, how it was tested, and any validation you could not run.
See `LICENSE` and `THIRD_PARTY_NOTICES.md` for licensing requirements.
