# T3 ownership

`src/t3/tasks` contains host-side T3 task adapters (MCP transport, native task mapping, launch identity, local notifications, web event formatting). It may depend on the task domain in `src/tasks`; `TaskManager` and `JobService` remain authoritative there. The task domain calls adapters at its integration boundary, not through compatibility re-exports.

`src/t3/web` contains the packaged web runtime: archive packing/extraction, embedded asset import and launcher. `src/cli.ts` calls the launcher. The embedded archive is still sourced from `dist/die-web.archive.gz`, and archive contents and external bootstrap paths are unchanged.

Canonical web input and build tooling live outside runtime source under `web/` and `integrations/t3/build/`; tests for these adapters/runtime live in `tests/t3/`.
