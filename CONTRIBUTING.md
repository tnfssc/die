# Contributing to die

Thanks for helping improve die. Small, focused changes with tests and clear commit
messages are easiest to review.

## Set up a development checkout

1. Fork the repository, then clone your fork and enter the checkout:

   ```sh
   git clone https://github.com/YOUR-ACCOUNT/die.git
   cd die
   ```

2. Install `tmux` (required by real-PTY tests), [Bun 1.4.2](https://bun.sh/), Node 24.21.0 and pnpm 11.27.1. Restore the exact lockfile:

   ```sh
   bun install --frozen-lockfile
   ```

3. Run the deterministic checks:

   ```sh
   bun run ci
   ```

The Linux CI workflow calls the same command. It includes formatting, lint, typecheck, the full build, offline transport checks, selected upstream tests, the deterministic suite and standalone smoke. It gives each run an isolated temporary directory. A Linux run does not prove macOS behavior; `bun run ci:macos` is the separate device-free macOS lane. See [local CI prerequisites](wisdom/ci/shared-local-ci-runner.md).

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

Read [the code map](ARCHITECTURE.md) before choosing a home for new code. It names runtime owners, shared boundaries, the canonical T3 integration, research archives and test/build discovery rules. Keep code with its real owner, not in whichever file already imports a similar type.

Prompt text belongs in `src/prompts/`. Start with [Editing prompts](wisdom/prompts/prompts.md) and the assembled input, not an isolated sentence. Preserve explicit custom prompts and instruction continuity.

`scripts/prepare-assets.ts` copies embedded Pi assets. Preserve license banners and update `THIRD_PARTY_NOTICES.md` and `third_party/` inputs when packaged assets or licensing change. Run `bun run generate:notices` to check attribution.

Background work belongs to the session. Execute worker exit must not kill jobs by accident. Keep history durable, handoffs cooperative and diagnostics bounded.

## Documentation and pull requests

For documentation-only edits, check the Markdown directly. Check links, command names, and claims against the current source. Do not describe planned work as
implemented. Before opening a pull request, run the deterministic commands above
and summarize what changed, how it was tested, and any validation you could not run.
See `LICENSE` and `THIRD_PARTY_NOTICES.md` for licensing requirements.
