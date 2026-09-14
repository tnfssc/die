# Project notes

- **Editing prompts? Start with [the prompt editing guide](../../docs/prompts.md).** It explains reviewing the whole input, decision reasons, and how to inspect assembly. [Model input source map](../../docs/system-instructions.md) lists sources and inclusion conditions.
- [Prompt review and shell stdin](prompt-review-2026-09-12.md): user-approved values, review position, stdin decision, and verified checks.
- [Durable prompt iteration](prompt-iteration-2026-09-13.md): review applied; Luna/medium live failures, Astra handoff and Sol memory success. Keep design; future checks target Sol/Astra. Process-scope incident recorded; shipped in v0.2.6.

- [Conversation spacing](thinking-spacing.md): compact thinking/non-user boundaries; plain unhighlighted rows around user messages. Installed; user confirmed.

- [Releases and Herdr sidebar investigation](releases-herdr-2026-09-13.md): v0.2.8 published and verified; spacing/Herdr fixes installed, sidebar recovered, tests isolated. No pending jobs.

- [Failed Go experiment](go-experiment.md): archived in ac80ddd, then removed at user request. Original app unchanged.

- [Execution row cleanup](ui-cleanup-2026-09-14.md): compact execute/task labels, truncated indicator, prose-only spacing; in progress.

- [Native compaction coverage investigation](native-compaction-coverage-2026-09-14.md): strict timestamp identity can falsely reject reconstructed task completions; current warning traced, no fix yet.

- [v0.2.9 release](release-v029.md): install/push/release authorized; full validation in progress.
