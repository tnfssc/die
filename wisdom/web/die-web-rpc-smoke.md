# die web RPC loopback smoke

Fixture: `scripts/die-web-rpc-smoke.ts`

Run with the repository's existing Bun and built executable:

```sh
bun scripts/die-web-rpc-smoke.ts
```

The fixture creates a mode-0700 directory directly under `/var/tmp`, isolates `HOME`, `PI_CODING_AGENT_DIR`, and `DIE_CODING_AGENT_DIR`, sets `HERDR_ENV=0`, and configures only a localhost OpenAI-compatible model. It drives the real `dist/die --mode rpc` JSONL protocol through `get_state` and `prompt`; the model requests an `execute` call containing one shell task and one fast subagent task. There are no provider calls outside loopback.

Captured files are mode 0600 and intentionally retained for browser/adapter debugging:

- `rpc-events.jsonl`
- `model-requests.json`
- `die-stderr.log`

Latest successful run: `/var/tmp/die-web-rpc-smoke-BPDL5J`

The smoke asserts RPC responses, execute start/end events, structured shell and agent summaries/output, task status UI events, and final parent output. Per `die-web-task-contract.md`, it also validates every `die_task_event` and requires both command and agent records when that optional producer event is present. Until the emitter lands in die, it falls back to the existing RPC `setStatus(die-tasks)` event rather than inventing another fixture transport.
