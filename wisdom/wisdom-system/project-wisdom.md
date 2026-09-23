# Project wisdom

Project wisdom is durable project context for future agents. It is not a model memory database and it does not grant permissions or override the user.

## Shape

Project wisdom lives in `wisdom/` at the repository root.

Organize wisdom by feature or system. Put the decision, reason, current state, and handoff with the area it explains. Do not split files only because one is a decision, audit, release note, or handoff.

There is no required `index.md`. Create a short orientation file only when it genuinely helps. There is no pending queue and no consolidation worker; agents write useful durable context directly into the relevant wisdom file.

## Prompt contract

The canonical root guidance is in [src/prompts/wisdom.md](../../src/prompts/wisdom.md). It asks agents to preserve decisions, reasons, status, and handoff context with the feature they explain.

[Derived values](../values.md) provide the concise cross-system layer. Read them before substantial work; review new wisdom at substantial completion/handoff and across affected systems after releases or broad reviews. Revise or merge existing principles before adding more, preserve evidence links and tradeoffs, and leave values unchanged when the review finds no new lesson. Briefly report the consolidation outcome at completion, including why no values change was needed when applicable.

This is a standing agent responsibility, not a background consolidation worker or mandatory index. See [derivation and coverage](derived-values.md) and the [practice audit](consolidation-practice-audit.md).

## Integration

`src/wisdom/extension.ts` appends the wisdom guidance for root agents and registers `/wisdom`, which reports the durable location. Child agents do not receive the root wisdom prompt.
