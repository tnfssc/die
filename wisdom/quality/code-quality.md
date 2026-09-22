# Code quality tooling

Biome `2.5.12` is exact-pinned for deterministic formatting and linting. TypeScript checking remains a separate `bun run check` step.

## Commands

- `bun run format`: rewrite supported project files.
- `bun run format:check`: report formatting drift without rewriting.
- `bun run lint`: run the recommended Biome rules, including correctness checks.
- `bun run check`: prepare generated assets and run TypeScript 7 with no emit.

Biome follows `.gitignore` and explicitly excludes dependency, generated, runtime, distribution, harness, and artifact directories. Markdown is excluded from formatting so prompt text and project documentation are never rewritten by the formatter. Test-only overrides suppress rules that are noisy for typed mocks and fixture code (explicit `any`, non-null assertions, banned placeholder types, and template-string preference); correctness checks such as unused imports and variables remain enabled.

## Resolved formatting baseline

The repository formatting baseline is now applied: `bun run format` checked 116 supported files and mechanically rewrote 102 files. `bun run format:check` succeeds with no formatting drift, and both CI and release workflows enforce that gate before linting.

At this baseline:

- `bun run lint` succeeds with the recommended rules enabled, reporting 132 warnings and 101 informational diagnostics. These diagnostics remain visible; rules are not suppressed to manufacture a clean result.
- `bun run format:check` succeeds after checking 116 files.
- `bun run check` succeeds with TypeScript 7.0.2. Biome also parses the Bun import-attribute forms (`with { type: "file" }` and `with { type: "text" }`) and the `*.md` ambient module declaration.

CI installs with `bun install --frozen-lockfile` and runs `bun run format:check`, `bun run lint`, and `bun run check` as separate steps. The release workflow applies the same quality gates.
