# T3 integration resources

This is the maintained resource/tooling boundary for the embedded T3 runtime.
Runtime code lives in `src/t3/`; direct tests live in `tests/t3/`.

- **One upstream input set:** `upstream/source.json` pins the repository and revision,
  `upstream/die.patch` is the canonical patch, and `upstream/bootstrap.mjs` is
  the packaged bootstrap. Builds, CI, and release attestation share these inputs.
- **One build:** `bun run build:web` runs `build/build.ts`;
  `build/verify-source.ts` rejects anything other than pinned HEAD plus that patch.
  `scripts/build.ts` remains the overall CLI/package orchestrator, including bootstrap
  refresh for `--reuse-web`. Generated output stays in `dist/` and revision-keyed `.cache/`.
- **Maintained gates:** `gates/` contains acceptance harnesses and migration templates.
  See [gate instructions](gates/README.md) for prerequisites and explicit opt-ins.
- **Shared contracts:** `fixtures/native-task-contract.json` serves root routing tests
  and upstream contract conformance, without separate fixture copies.

## What runs when

Routine offline verification is `bun run check`, `bun test ./tests` (after building),
plus CI pinned-source checks. Contract conformance and migration checks need prepared
checkouts but never install dependencies. Packaging checks need a reviewed built binary.
Browser, model/provider, and native acceptance are manual: they may need browser tools,
credentials, or devices. Do not add those to automatic discovery or bypass their guards.

[Experiments](../../experiments/t3/README.md) preserve preview, production-candidate,
and old-pin investigation history. They are not current gates or alternate build pipelines
and are not automatically executed. Archived files retain historical paths and provenance;
those paths are not compatibility aliases. Generic CLI scripts, native helpers, and
release notes retain their role roots (`scripts/`, `native/`, `support/`).
