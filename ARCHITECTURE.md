# Code map

Start here when adding or moving code. A folder names an owner, not the date or project phase in which a file was written. Shared rules have one source. Similar words do not make two responsibilities the same.

## Runtime owners

| Home | Owns | Does not own |
| --- | --- | --- |
| `src/cli.ts` | Process entry, CLI routing and standalone startup | A second agent or scheduler |
| `src/agent/` | Agent composition, model/context hooks, compaction and instruction policy | Job lifecycle or storage schemas |
| `src/tasks/` | TaskManager, JobService, child execution, worktrees, attention and completion | Provider adapters or web startup |
| `src/typescript/` | Execute worker, IPC, output capture and tool registration | Background job lifetime |
| `src/session/` | Shared session authority, completed-input handoff, history snapshots and identity | Live provider/audio policy |
| `src/history/` | Durable history storage, retrieval and persisted-record validation | Agent commands or model policy |
| `src/live/` | Voice providers, audio, provider transcript adaptation and voice UI | A separate task/session authority |
| `src/t3/` | Die-side T3 protocol adapters and packaged web startup | Upstream application source or a separate TaskManager |
| `src/goals/` | Goal state and continuation policy | Task execution |
| `src/ui/` | Terminal rendering and interaction | Domain state ownership |
| `src/prompts/` | Maintained prompt text | Generated prompts or provider transport code |

Small root contracts such as `job-delivery.ts`, `delegation-environment.ts` and `output-buffer.ts` serve several owners. Do not make a generic utilities folder for code that already has a clear owner. `prompts.ts` assembles text; `system-prompt.ts` decides base-prompt precedence. Those remain different jobs.

The agent extension composes the existing services. Session authority sees a narrow task port. Live and T3 use those authorities; they do not start another scheduler. History reads a small shake-record contract rather than importing the command that creates the record.

## T3 is one subsystem, not one giant folder

Its locations follow the same source/tool/test roles as the rest of the repository:

- `src/t3/`: host-side runtime code.
- `integrations/t3/`: canonical upstream inputs, packaging, maintained gates and shared fixtures. Start with its README.
- `tests/t3/`: deterministic integration tests, discovered by the normal test command.
- `experiments/t3/`: clearly labeled historical research, candidates and proof. Not production inputs or normal verification gates.
- `wisdom/t3/`: dated decisions and evidence. A past path/pin in a note is not a current build manifest.

The upstream application lives in an external checkout. Its reviewed source here is exactly `integrations/t3/upstream/source.json` plus `die.patch`. Never build from a candidate patch merely because its filename says production. V2 is still a valid upstream protocol/domain name; do not rename wire fields, schemas or saved data for folder tidiness.

Keep historical `git show COMMIT:old/path` references intact. They identify Git objects, not current checkout paths. Archive evidence without changing its claims or deleting ignored/private user state.

## Build, tests and generated data

- `scripts/` owns whole-product commands, release orchestration and non-T3 tools. It may call the T3 build; it must not own a second copy.
- `native/` owns native source and native-language tests.
- `tests/` is the recursive deterministic test root. Feature test folders stay under it.
- `support/` holds versioned release notes. `third_party/` holds license inputs.
- `dist/`, `runtime-assets/`, `.cache/` and `artifacts/` are generated, ignored outputs—not alternate source homes.

Typecheck and lint must still cover maintained code after a move. Tests must still be discovered. A successful existing archive repack is not proof that a changed upstream patch builds from source.

Run `bun run ci` with the documented pinned tools before pushing. CI uses that same Linux gate. macOS and release artifact checks have separate platform responsibilities. See [Contributing](CONTRIBUTING.md).

`tests/architecture.test.ts` checks key dependency directions and single-source locations. `tests/session-boundaries.test.ts` protects the provider-independent session boundary. Add small checks for concrete boundaries, not a framework that forbids every possible dependency.
