# Contributing to die

Thanks for helping improve die. Small, focused changes with tests and clear commit
messages are easiest to review.

## Set up a development checkout

1. Fork the repository, then clone your fork and enter the checkout:

   ```sh
   git clone https://github.com/YOUR-ACCOUNT/die.git
   cd die
   ```

2. Install `tmux` (required by real-PTY tests) and [Bun 1.4.1](https://bun.sh/) and restore the exact lockfile:

   ```sh
   bun install --frozen-lockfile
   ```

3. Run the deterministic checks:

   ```sh
   bun run format:check
   bun run check
   bun run build
   bun test ./tests
   bun run smoke
   ```

Both pull-request CI and the release workflow run the formatting check. When you format changes, use the pinned Biome version in `devDependencies`.

Do not commit generated `dist/`, `runtime-assets/`, test artifacts, credentials,
or local configuration.

## Test policy

The normal test suite is deterministic. It must not need credentials or a paid model. Tests that make real model requests use the `DIE_RUN_LLM_TESTS=1` guard. They are opt-in, may cost money, and do not run in CI. Enable them only when you understand the cost and have set your own provider credentials. Prefer pure tests and offline SDK fixtures. Use the
real TUI harness when terminal behavior itself is under test, and keep diagnostics
bounded so failures remain readable. Preserve the suite's skip accounting: a gated
fixture must remain discovered and skipped when `DIE_RUN_LLM_TESTS` is unset rather
than disappearing behind conditional test registration.

Goal lifecycle changes should test the pure store/controller contract. Where the Pi boundary matters, also use an offline SDK or TUI fixture. The natural real-model goal smoke
is `tests/goals-live.test.ts`. Run it only with `DIE_RUN_LLM_TESTS=1` and configured
credentials. It creates temporary local resources and writes bounded evidence under
ignored `artifacts/goals/`. Do not describe a mocked SDK stream as live-model evidence.

## Architecture

- `src/cli.ts` owns startup, the standalone runtime, and Pi integration.
- `src/typescript/` implements the single `execute` tool and its process/job bridge.
- `src/tasks/` implements durable jobs, sub-agents, completion delivery, and
  persisted session diagnostics.
- `src/goals/` implements branch-scoped durable goal state and continuation policy;
  user-facing behavior is documented in `wisdom/goals/goals.md`.
- `src/ui/` contains TUI behavior.
- `src/prompts/*.md` are the source prompts imported by `src/prompts.ts`.
  Start with [Editing prompts](./wisdom/prompts/prompts.md) and the assembled input, not an isolated
  sentence. Edit Markdown rather than generated representations, and preserve explicit
  custom prompts and instruction continuity.
- `scripts/prepare-assets.ts` copies the Pi runtime assets embedded by the build.
  Preserve upstream license banners and update `THIRD_PARTY_NOTICES.md` and the
  curated inputs under `third_party/` when the packaged asset set or licensing changes.
  Run `bun run generate:notices` to verify the production attribution bundle.

Background work belongs to the session. Do not let an execute worker exit kill jobs by accident. Keep history durable, handoffs cooperative, and failure diagnostics bounded.

## Documentation and pull requests

For documentation-only edits, check the Markdown directly. Check links, command names, and claims against the current source. Do not describe planned work as
implemented. Before opening a pull request, run the deterministic commands above
and summarize what changed, how it was tested, and any validation you could not run.
See `LICENSE` and `THIRD_PARTY_NOTICES.md` for licensing requirements.
