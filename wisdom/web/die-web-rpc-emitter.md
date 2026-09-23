# Die web RPC task lifecycle emitter

## Progress
- 2026-09-14: The producer contract led to the existing TaskManager subscription in `src/tasks/extension.ts`.
- Plan: add a tiny independently tested RPC-only NDJSON formatter/emitter helper, then attach it to that subscription.
  It will detect only explicit `--mode rpc`/`--mode=rpc`, source-bound command to 400 characters and output to 2000 characters, and project only contract agent metadata.
- No CLI/web edits; no conversation messages or persistence.

## Status
Complete.

## Coordination
- 2026-09-14 10:03: A concurrent `src/tasks/web-events.ts` hook appeared in the owned extension while this task was running.
  It required `DIE_WEB_TASK_EVENTS=1`, emitted only start/completion, bounded command to 240, and omitted required timestamps/output/progress.
  I removed that hook from `extension.ts` and attached the contract-complete argv-gated emitter instead. **Do not restore the env-gated webTaskEvent hook or both producers will emit duplicates.** The untracked helper itself was left untouched because another worker owns it.
- Focused tests (3/3) and full TypeScript check pass with `HERDR_ENV=0 TMPDIR=/var/tmp`.
- Validation: task emitter + TaskManager suites 24/24 pass; `bun run check` passes; compiled `dist/die` rebuilt successfully at 10:04 with emitter included.
