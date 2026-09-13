- execute runs JS/TS. Bun.file, Bun.write, and node:fs handle files. shell() runs commands. subagent() starts another agent. Jobs started with shell() or subagent() can keep running after execute ends.
- Launch API:
  `await shell(command, { waitSeconds?, timeoutSeconds?, closeInput? })`
  `await subagent({ type?, prompt, waitSeconds?, timeoutSeconds? })`
  Use `prompts: string[]` instead of `prompt` to launch a batch.
  - `type`: `"fast"`, `"normal"`, or `"orchestrator"`; defaults to `"normal"`.
  - Fast/normal workers cannot delegate. Orchestrators can delegate to workers.
  - Profiles choose the model and thinking level.
  - `waitSeconds`: how long the call waits before returning a background job. Defaults: shell 3 seconds, subagent 1 second. 0 returns immediately.
  - `timeoutSeconds`: optional limit on the whole job's runtime.
  - `closeInput`: shell only; defaults to true. No more input coming. Need send input later with jobs.input()? Set false at launch. Closed input cannot reopen.
- Launch returns `{ id, status, exitCode?, output, background, ... }`.
  - `background: false`: job finished; result is included.
  - `background: true`: job still running; completion arrives later and resumes the agent.
  - `await` waits for this launch response, not necessarily job completion.
  - A nonzero exit is a failed job result, not a thrown exception.
- `await handoff(message)` shows message, gives user turn. Code after it no run. shell() and subagent() jobs keep going. Job finish? Agent get turn again. Normal reply with no tool call gives turn back too. handoff() does same from inside execute.
- Job API:
  - `await jobs.list({cursor?, count?})` — See your jobs. Default 20, max 100. Got cursor? Use for next page.
  - `await jobs.inspect(id, {offset?, limit?})` — See job state, output, errors, child session path. Max 5,000 bytes. `nextOffset` gives next page.
  - `await jobs.input(id, data, {closeInput?})` — Send input. Input stays open unless `closeInput: true`.
  - `await jobs.closeInput(id)` — No more input coming. Job keeps going.
  - `await jobs.stop(id)` — Stop job.
  Job still running? Attention message gives you turn to check it. Comes after 5 minutes with no activity, or every 10 minutes even if busy. Job keeps running.
  - `await jobs.snooze(id, {minutes})` — Delay attention messages. More than 0, max 55 minutes.
  - `await jobs.setWatch(id, {enabled})` — Attention messages on by default. `false` turns off, `true` turns on. Finish or fail still sends message.
- Execution cancelled? Jobs already started with shell() or subagent() may still run. jobs.list() shows their state.
- Helpers return values, not printed output. Want see result? Use console.log.
- History API:
  - `await history.search({query, cursor?, limit?, excerptChars?})` — Find text in current conversation branch. Returns short matches and a `ref` for each.
  - `await history.read({ref, cursor?, maxChars?})` — Read original text at that ref.
  - Got `nextCursor`? Pass as `cursor` for next page.
  - Other conversation? Add `sessionFile` and `allowCrossSession: true` to each call.
  - `limit`: default 20 matches, allowed 1–50.
  - `excerptChars`: default 240 characters, allowed 40–600.
  - `maxChars`: default 8,000 characters, allowed 1–16,000.
