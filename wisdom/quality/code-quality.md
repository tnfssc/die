# Code quality tooling

Biome `2.5.12` is pinned exactly so formatting and lint results stay stable. TypeScript checks remain a separate `bun run check` step.

## Commands

- `bun run format`: rewrites supported project files.
- `bun run format:check`: finds format drift without changing files.
- `bun run lint`: runs the recommended Biome rules, including correctness checks.
- `bun run check`: prepares generated assets and runs TypeScript 7 without emitting files.

Biome follows `.gitignore`. It also leaves out dependency, generated, runtime, distribution, harness, and artifact directories. Markdown formatting is off, so the formatter never rewrites prompts or project docs. Test-only overrides turn off rules that add noise to typed mocks and fixtures: explicit `any`, non-null assertions, banned placeholder types, and template-string preference. Correctness rules such as unused imports and variables stay on.

## Resolved formatting baseline

The repo now has one formatting baseline. `bun run format` checked 116 supported files and rewrote 102 of them. `bun run format:check` then passed with no drift. CI and release both run this gate before lint.

At this baseline:

- `bun run lint` passes with recommended rules on. It reports 132 warnings and 101 informational diagnostics. They stay visible; no rules were hidden to make the result look clean.
- `bun run format:check` passes after checking 116 files.
- `bun run check` passes with TypeScript 7.0.2. Biome can also parse Bun import attributes (`with { type: "file" }` and `with { type: "text" }`) and the `*.md` ambient module declaration.

CI uses `bun install --frozen-lockfile`. It then runs `bun run format:check`, `bun run lint`, and `bun run check` as separate steps. The release workflow runs the same quality gates.
