# Die → Pi RPC task event contract

The Pi adapter needs lifecycle records for jobs started *inside* the `execute` tool.
Tool results alone are insufficient: foreground `subagent` results are only rendered into execute stdout, and background launch details now contain IDs but not kind/agent metadata.

Emit one raw NDJSON RPC event for each TaskManager event (not a model-visible custom message):

```json
{"type":"die_task_event","event":"started|progress|completed","task":{"id":"task_ab12","kind":"command|agent","status":"running|completed|failed|killed","command":"bounded label","startedAt":"ISO","completedAt":"ISO?","lastActivityAt":"ISO?","exitCode":0,"signal":"SIGTERM?","timedOut":false,"agent":{"type":"fast|normal|orchestrator","model":"provider/model?","thinking":"level?"}},"output":"terminal/preview text?"}
```

Rules:
- `started` corresponds to TaskManager `spawned`; `progress` to `activity` or `stopping`; `completed` to `completed`.
- `task.id`, `task.kind`, `task.status` are required. Adapter ignores malformed records.
- Keep `command` <= 400 chars and optional `output` <= 2000 chars at source. Do not include full buffers or prompts.
- This is transport telemetry only: don't persist/inject it into the conversation and don't trigger a turn.
- Existing Pi events and execute results stay as they are.

Adapter also bounds tracked die jobs to 50 per session and truncates displayed strings, so producer bursts can't grow server state/UI without limit.
