# Go-native Markdown resources

## Implemented

- New pure-Go `internal/resources` package discovers, validates, and expands Agent Skills and prompt templates. Resource files are bounded to 1 MiB and directory walks to 4096 entries; malformed, unreadable, missing, oversized, and colliding skills produce warnings.
- Default skills: `<state-dir>/skills`, `~/.agents/skills`, trusted `<cwd>/.pi/skills`, and trusted ancestor `.agents/skills` up to the repository root. `SKILL.md` trees recurse; Pi roots accept direct Markdown and Agents roots accept grouped nested Markdown. Hidden directories and `node_modules` are skipped.
- Default templates: `<state-dir>/prompts/*.md` and trusted `<cwd>/.pi/prompts/*.md`, non-recursively.
- `--skill` and `--prompt-template` are repeatable explicit additions. `--no-skills`/`-ns` and `--no-prompt-templates`/`-np` suppress defaults but not explicit paths.
- `--no-approve` suppresses all project resource discovery as well as existing project context. `--no-context-files` only suppresses AGENTS/CLAUDE context and does not disable resources.
- The system prompt receives only the skill inventory (name, description, location). Skills marked `disable-model-invocation: true` remain explicitly callable but are absent from inventory. Full Markdown is read only for `/skill:name [arguments]` and wrapped with its absolute base directory.
- Templates expand `/name [arguments]` with source-compatible quote splitting, `$N`, `$@`, `$ARGUMENTS`, defaults, and slices. Substitution is single-pass. Built-in local slash commands retain precedence; skills expand before templates.
- Resource warnings are emitted to stderr rather than turning optional discovery errors into startup failure.

## Deliberately unsupported

There are no remaining unsupported Pi resource CLI flags. Package-manifest resources, JavaScript extensions, the Pi package configuration TUI, settings.json resource arrays, and experimental `allowed-tools` pre-approval are not CLI flags and are not implemented. Markdown skills may still reference scripts for the model to invoke through `execute`; godie does not execute resource code during discovery.

## Verification

- Focused race tests: `go test -race ./internal/resources` and resource-focused `internal/app` tests.
- Loopback acceptance runs both the original Pi CLI and the candidate against a real custom OpenAI-compatible HTTP provider: print-mode prompt-template expansion and controlling-PTY `/skill:fixture` invocation. Normalized provider-visible template and skill messages match exactly; the candidate loopback response also renders in the PTY.
- Evidence: `evidence/resources-original.json`, `evidence/resources-loopback.json`, `evidence/resources-comparison.json`, their `resources-*.log`/acceptance drivers, and isolated candidate `evidence/resources-godie` (never `bin/godie`).
