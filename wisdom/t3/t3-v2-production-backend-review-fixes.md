# T3 v2 production backend review fixes

## Scope

Owned the backend P0 cancellation/launch race and investigated the root-provider identity P0. I did not modify or run `NativeDieIntegration.production.test.ts`. Continuation and schema/readonly work remain owned by the other workers.

## P0: durable ancestor cancellation fence

### Repair

- `Orchestrator.ts` now serializes `delegated_task.request` and `delegated_task.cancel` through one delegated-task mutation permit, in addition to the existing per-thread command lock.
- Marked native-Die creation re-reads every persisted ancestor edge inside that serialization boundary. Every edge must still be app-owned, marked as Die-created, nonterminal, and not have disposed completion delivery.
- Cancellation already writes the durable `cancelled` status and disposed delivery before interrupting. That row is now the durable fence: if cancellation wins the boundary, every later descendant request is rejected before child events/effects or provider process launch can be produced. If creation wins, its durable child is visible to the later subtree walk and is torn down.
- `ProviderSessionManager.ts` and `DieDelegationPolicy.ts` apply the same open-edge rule when deriving/reissuing restricted native-Die authority, preventing cancelled descendants from regaining delegation credentials after restart/re-attach.

### Regression coverage

- Added a barrier regression that pauses a descendant at the creation boundary, cancels the ancestor, verifies the pre-existing descendant is torn down, resumes creation, and proves failure with no descendant row or process launch.
- Added policy coverage proving terminal and disposed ancestor edges deny authority and that only a live edge restores it.
- The production boundary itself is in the orchestrator (not a process-local check in the MCP handler), so child creation and the provider-start effect are both absent when the durable fence wins.

## P0: root identity investigation — source-grounded nonfinding

No ordinary Pi process can share the built-in `providerInstanceId=pi` identity while `DIE_WEB_DIE_BINARY` is configured:

1. `PiAdapterV2Driver.create` merges the host environment and calls `applyDieWebPiSettings`.
2. `applyDieWebPiSettings` force-replaces the Pi adapter's configured `binaryPath` with `DIE_WEB_DIE_BINARY` and enables it. It does not dispatch between ordinary Pi and Die per thread/model.
3. Provider adapter lookup is by unique provider instance id, so all sessions dispatched to built-in `pi` use that replaced executable in this server configuration.
4. The MCP credential decision reads server-owned `process.env`, not provider/model-supplied environment. No model environment authority was added.

I extracted `isTrustedDieProviderInstance` to make that trust decision explicit and added coverage that:

- configured built-in `pi` is trusted;
- an unconfigured `pi` is not trusted;
- a distinct Pi instance is denied native-Die identity; and
- server configuration replaces an ordinary configured Pi binary with Die.

So a new persisted provider-kind field would duplicate existing server configuration rather than fix an actual identity collision. Distinct provider instances remain denied.

## Verification

- Focused backend suite passed: 3 files, 9 tests (`DieTaskService.test.ts`, `DieDelegationPolicy.test.ts`, and `DieWebPi.test.ts`).
- Plain TypeScript diagnostics reported no hard errors in the modified production/test files; the full server diagnostic command remains nonzero on pre-existing repository-wide Effect suggestions/errors outside this scope.
- `git diff --check`: clean.

## Urgent follow-up: fail-closed native credential reopening

- Fixed the native credential minting fallback in `ProviderSessionManager.ts`: a server-trusted Die provider with invalid/missing live lineage now receives only an explicit restricted non-delegation scope (worktree/pull-request plus enabled preview/device tools). It can reopen terminal history, but receives neither `orchestration` nor `die-delegation`. Untrusted ordinary providers keep the generic orchestration path.
- Credential reuse now requires exact capability-set equality as well as matching thread, provider, and delegation metadata. A previously issued unrestricted/generic orchestration credential is revoked and rotated after lineage becomes invalid.
- Split trusted native-child retention identity from live delegation authorization. A trusted child remains on the 5-second production idle policy even when its completed/disposed edge correctly denies delegation; roots remain on the 30-minute default. This restores the resource-41 terminal-history fixture without weakening authorization.
- Added an actual registry-backed manager regression for terminal, disposed, and forged/provider-native ancestry. Each case seeds a valid legacy generic credential, opens the trusted native child, proves rotation/revocation, and proves the resulting registry scope has no orchestration or Die delegation capability.

### Follow-up verification

- `ProviderSessionManager.test.ts`: 42/42 passed, including production resource/PID coverage and the new registry denial matrix.
- `DieDelegationPolicy.test.ts` + `DieTaskService.test.ts`: 6/6 passed.
- `git diff --check`: clean.
- Server `tsc --noEmit` remains nonzero because the repository treats the existing Effect suggestion diagnostics as failures; a filtered rerun contains no hard diagnostic or suggestion in the changed manager/test files.
- Browser files were not touched; coordinator must include these shared-worktree backend edits in the final re-export after active browser builds complete.
