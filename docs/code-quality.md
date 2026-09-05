# Code quality tooling

Biome `2.5.12` is exact-pinned for deterministic formatting and linting. TypeScript checking remains a separate `bun run check` step.

## Commands

- `bun run format`: rewrite supported project files.
- `bun run format:check`: report formatting drift without rewriting.
- `bun run lint`: run the recommended Biome rules, including correctness checks.
- `bun run check`: prepare generated assets and run TypeScript 7 with no emit.

Biome follows `.gitignore` and explicitly excludes dependency, generated, runtime, distribution, harness, and artifact directories. Markdown is excluded from formatting so prompt text and project documentation are never rewritten by the formatter. Test-only overrides suppress rules that are noisy for typed mocks and fixture code (explicit `any`, non-null assertions, banned placeholder types, and template-string preference); correctness checks such as unused imports and variables remain enabled.

## Initial baseline

No existing source was rewritten in the tooling commit. At this baseline:

- `bun run lint` succeeds with 70 warnings and 60 informational diagnostics. The main source debt is template-string preference, non-null assertions, explicit `any`, and three implicitly typed declarations; test correctness findings remain visible.
- `bun run format:check` intentionally fails with 74 formatting diagnostics across the pre-existing source and tests. Apply these only in the planned formatter-only commit after parallel feature branches merge.
- `bun run check` succeeds with TypeScript 7.0.2. Biome also parses the Bun import-attribute forms (`with { type: "file" }` and `with { type: "text" }`) and the `*.md` ambient module declaration.
- `bun install --frozen-lockfile` succeeds with the updated lockfile.

CI should install with `bun install --frozen-lockfile` and run `bun run lint`, `bun run format:check`, and `bun run check` as separate steps. Enable the format gate after the formatter-only baseline commit lands.
