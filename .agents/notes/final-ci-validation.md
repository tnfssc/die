# Final CI validation

## Scope

Validated the pinned, dependency-consistent upstream checkout at `.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e` (HEAD `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`). No web source or patch was edited.

CI now runs the model regressions from `apps/web` with `--project unit`, and the server selection now includes the previously missing focused terminal regressions `Manager.test.ts` and `SubscriberStream.test.ts`. The focused root workspace regression is already covered by CI's `bun test ./tests`, so it was not duplicated as another workflow step.

## Validation results

All commands passed:

- Server upstream selection, excluding only `src/orchestration-v2/NativeDieIntegration.production.test.ts`: **15 files, 257 tests**. This includes the existing Pi provider, environment auth, server startup, Node/Bun PTY, MCP, orchestration, and telemetry cases plus the two terminal regression files.
- Focused terminal subset (rerun separately for an exact focused count): `src/terminal/Manager.test.ts` and `src/terminal/SubscriberStream.test.ts`: **2 files, 88 tests**. This is a subset of the 15-file/257-test server result and must not be added to its total.
- Contracts selection: `browserProfile.test.ts`, `orchestratorMcp.test.ts`, and `providerRuntime.test.ts`: **3 files, 26 tests**.
- Client projection: `orchestrationV2Projection.test.ts`: **1 file, 9 tests**.
- Focused model unit project from `apps/web`: `src/composerDraftStore.test.ts` and `src/lib/chatThreadActions.test.ts`: **2 files, 158 tests**.
- Focused root workspace regression: `bun test tests/worktree-workspace.test.ts`: **1 file, 9 tests, 36 expect calls**.

The unique upstream workflow selections exercised here total **21 files and 450 tests** (server 257 + contracts 26 + client 9 + web model 158). The root workspace result is separate from that upstream total.

## Caveats

- Per coordination, `NativeDieIntegration.production.test.ts` was deliberately not run; the coordinator is building the final `dist/die` and will run that native harness against the final binary.
- This validation ran all upstream test commands represented by the updated workflow, but did not rerun the workflow's install, format, lint, typecheck, build, full root deterministic suite, or smoke steps.
- The complete upstream `@t3tools/web` suite is **not** run by Die CI. The prior statement in `model-integration-final.md` was corrected; Die CI now gates only the two focused model files requested here.
