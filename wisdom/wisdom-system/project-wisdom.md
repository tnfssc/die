# Project wisdom

Project wisdom is context saved for the next agent. It is not a model memory database. It gives no permission. User's words come first.

## Shape

Project wisdom lives in `wisdom/` at repo root.

Put wisdom with the feature or system it explains. Keep the choice, reason, current state, and handoff together. Do not split files only because one part is a decision, audit, release note, or handoff.

No `index.md` is required. Make a short map only when it helps. There is no pending queue or cleanup worker. Agents write useful context straight into the right wisdom file.

## Prompt contract

Root guidance lives in [src/prompts/wisdom.md](../../src/prompts/wisdom.md). It tells agents to save choices, reasons, state, and handoff context with the feature they explain.

[Values](../values.md) hold lessons that help across the project. Read them before big work. At a big finish or handoff, review new wisdom. After a release or wide review, check all affected systems. Merge or change old lessons before adding more. Link where each lesson came from. Say when it helps and when it does not. No new lesson? Leave values alone. At finish, say what wisdom changed and what values changed. Values stayed same? Say why.

This is the agent's job. It is not a background cleanup worker or required index. See [how values were derived and what was covered](derived-values.md) and the [practice audit](consolidation-practice-audit.md).

## Integration

`src/wisdom/extension.ts` adds wisdom guidance for root agents. It also registers `/wisdom`, which reports the durable location. Child agents do not get the root wisdom prompt.
