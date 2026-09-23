# Final CI validation

## Scope

Checked the pinned upstream checkout with its matching dependencies at `.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e` (HEAD `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`). No web source or patch changed.

CI now runs the model regressions from `apps/web` with `--project unit`, and the server selection now includes the previously missing focused terminal regressions `Manager.test.ts` and `SubscriberStream.test.ts`. CI already covers the focused root workspace regression through `bun test ./tests`, so there is no duplicate workflow step.

## Validation results

Every command passed:

- Server upstream selection, excluding only `src/orchestration-v2/NativeDieIntegration.production.test.ts`: **15 files, 257 tests**. This includes the existing Pi provider, environment auth, server startup, Node/Bun PTY, MCP, orchestration, and telemetry cases plus the two terminal regression files.
- Focused terminal subset (rerun separately for an exact focused count): `src/terminal/Manager.test.ts` and `src/terminal/SubscriberStream.test.ts`: **2 files, 88 tests**. These tests are part of the 15-file, 257-test server result. Do not add them to that total again.
- Contracts selection: `browserProfile.test.ts`, `orchestratorMcp.test.ts`, and `providerRuntime.test.ts`: **3 files, 26 tests**.
- Client projection: `orchestrationV2Projection.test.ts`: **1 file, 9 tests**.
- Focused model unit project from `apps/web`: `src/composerDraftStore.test.ts` and `src/lib/chatThreadActions.test.ts`: **2 files, 158 tests**.
- Focused root workspace regression: `bun test tests/worktree-workspace.test.ts`: **1 file, 9 tests, 36 expect calls**.

The unique upstream workflow selections exercised here total **21 files and 450 tests** (server 257 + contracts 26 + client 9 + web model 158). The root workspace result is not part of that upstream total.

## Caveats

- As agreed, `NativeDieIntegration.production.test.ts` did not run. The coordinator is building the final `dist/die` and will run that native harness against the final binary.
- This check ran every upstream test command in the updated workflow. It did not rerun the workflow's install, format, lint, typecheck, build, full root deterministic suite, or smoke steps.
- Die CI does **not** run the full upstream `@t3tools/web` suite. The prior statement in `model-integration-final.md` was corrected; Die CI now gates only the two focused model files requested here.
