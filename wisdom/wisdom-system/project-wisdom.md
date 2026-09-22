# Project wisdom

Project wisdom is durable project context for future agents. It is not a model memory database and it does not grant permissions or override the user.

## Shape

Project wisdom lives in `wisdom/` at the repository root.

Organize wisdom by feature or system. Put the decision, reason, current state, and handoff with the area it explains. Do not split files only because one is a decision, audit, release note, or handoff.

There is no required `index.md`. Create a short orientation file only when it genuinely helps. There is no pending queue and no consolidation worker; agents write useful durable context directly into the relevant wisdom file.

## Prompt contract

The root prompt says:

```md
Next agent not hear whole talk. Save decisions, reasons, and where work stopped. No need copy whole conversation.

Work not done if next person cannot pick it up. Leave code and wisdom together, where others can get both. Say what finished and what still needs care.

Project wisdom lives in wisdom/. Put it with the feature or system it explains. Need past context? Read the wisdom that helps with this task.
```

That prompt is the source of truth for agent behavior. Implementation should stay simple enough to match it.

## Integration

`src/wisdom/extension.ts` appends the wisdom guidance for root agents and registers `/wisdom`, which reports the durable location. Child agents do not receive the root wisdom prompt.
