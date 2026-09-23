# T3 V2 production migration + packaging preservation validation

## Verdict

Candidate `a9b49a7df0a4261dcc438d4493cc3154a1d9819e` successfully migrates a fresh synthetic canonical `719a76ca1dbf5490f1aa33ffb9966301e02be9a9` (v0.4) state. Two candidate starts kept thread metadata, all six messages, old provider-session/runtime rows, old turn/checkpoint history, and source DB immutability. Existing V2 tests also pass for provider-session replay, restart continuation, and cross-thread native-subagent graph rebuild.

Found and fixed a real packaging mismatch in candidate source: upstream split the CLI into `bin.ts` / `binCli.ts`, so the embedded launcher’s documented `import("./dist/bin.mjs").runCli(args)` returned `undefined`. `apps/server/src/bin.ts` now exports the lazy bridge and `binCli.ts` supports the explicit-argument, teardown-aware promise contract while retaining normal Node entry behavior.

Did not change canonical pin/patch, installed binary, release artifact, user DB/session, or user process. `dist/die-t3-v2-root` was not overwritten and the coordinated full `dist/die-t3-v2-candidate` was not produced.

## Actual migration path and scope

1. Explicit/default production state resolves to `<stateDir>/statev2.sqlite`. The old DB is `<stateDir>/state.sqlite`.
2. On first V2 start only, `initializeV2Database` opens old state read-only and uses `node:sqlite.backup` to a same-directory temporary snapshot, then hard-links the complete snapshot into place. Existing `statev2.sqlite` always wins. WAL committed state is included. The old file is never migrated in place.
3. Candidate runs migrations 53 (PullRequestFilesViewed) and 54 (OrchestrationV2 and additive sub-migrations) against the copy.
4. Startup `LegacyV1ThreadImporter.reconcileShells` emits deterministic V2 events for old thread metadata plus a bounded shell preview (latest user and latest message). `importPendingTranscripts` / `ensureTranscript` then emits deterministic message and turn-item events for the full transcript. `orchestration_v2_legacy_imports` makes both phases restart-idempotent.
5. Old `projection_thread_sessions`, `provider_session_runtime`, `projection_turns`, checkpoint refs, and all other V1 tables remain byte-for-byte data in the copied DB. They are preservation records, not rebound as an active V2 provider thread: imported `activeProviderThreadId` is deliberately null. Resuming a pre-V2 live provider process would be unsafe and is not claimed. Conversation history is available and a later turn starts a V2-managed provider session.
6. Canonical v0.4 has no V2 native-child graph. Existing V2 state uses event replay/projection rebuild. The focused current-state tests below verify provider-session sharing, restart continuation, and cross-thread subagent relations.

No compatible conversion was missing in the exercised path. In particular, manufacturing a V2 active provider binding from a stale V1 runtime row would invent lifecycle state and weaken, not improve, integrity.

## Reproducible synthetic migration test

All state was under `/var/tmp`. The old checkout was a detached temporary worktree, never a user or historical DB copy:

```sh
cd /home/tnfssc/Code/die/.cache/die-t3code-v2-production
git worktree add --detach /var/tmp/die-t3-old-719a76 719a76ca1dbf5490f1aa33ffb9966301e02be9a9
# Resolve the already-present workspace dependencies; no package/source pin change.
ln -s "$PWD/apps/server/node_modules" /var/tmp/die-t3-old-719a76/apps/server/node_modules
mkdir -p /var/tmp/die-migration-fixture
```

The fixture program ran the **old checkout's** `apps/server/src/persistence/Migrations.ts::runMigrations()` through `NodeSqliteClient.layer`, proving migrations 1..52, then inserted schema-valid synthetic projection state only:

- project `legacy-project` rooted at `/var/tmp/synthetic-project`;
- plan-mode thread `legacy-thread`, branch/worktree, settled/pinned/order metadata and canonical Codex model selection;
- six alternating user/assistant messages dated in stable order;
- `projection_thread_sessions`: idle `legacy-provider-session` / `legacy-provider-thread`;
- `provider_session_runtime`: canonical instance, synthetic resume cursor and runtime payload;
- completed `projection_turns` row with `refs/t3/checkpoints/synthetic`.

It did not synthesize event payloads outside old domain schemas. Candidate validation called `initializeV2Database`, current `runMigrations`, `LegacyV1ThreadImporter.reconcileShells`, `ensureTranscript`, and `ProjectionStoreV2.getThreadProjection`. It rebuilt those layers and repeated the query as a restart.

Observed result:

```json
{"first":{"importedThreadCount":1,"importedMessageCount":2},"second":{"importedThreadCount":0,"importedMessageCount":0},"messages":6,"legacyProviderSession":"preserved","legacyHistory":"preserved","v2Migration":54}
```

The packaged live-start test then copied only this generated `state.sqlite` into a new private base dir. First start logged migrations 53/54, shell import 1/2 and background hydration 1/4. Graceful stop and second start logged no repeat import; HTTP served the packaged client (200). Final SQL: one V2 thread, six V2 messages, hydrated import count 6, unchanged idle provider IDs, zero fabricated native nodes, max migration 54. Old source hash before/after: `22009ef8e2c05bd1bf7ae4d7a3354e654739b43c0a88b30b1244d61412973bb1`.

Repository migration regression command:

```sh
cd .cache/die-t3code-v2-production
TMPDIR=/var/tmp ./node_modules/.bin/vp test run \
  apps/server/src/persistence/initializeV2Database.test.ts \
  apps/server/src/orchestration-v2/LegacyV1ThreadImporter.test.ts \
  apps/server/src/persistence/reconcileV2PreviewMigration.test.ts
# 3 files, 9 tests passed

TMPDIR=/var/tmp ./node_modules/.bin/vp test run \
  apps/server/src/orchestration-v2/FoundationPersistence.test.ts \
  -t 'replays shared provider-session payloads|rebuilds projections with cross-thread subagent relations|restart continuation'
# 1 file, 3 passed (34 skipped)
```


## Reproducible synthetic migration acceptance follow-up

The previously temporary fixture is now tracked as
`scripts/t3-v2-production/migration-acceptance.ts` with its two focused fixture
programs. It uses unique `mkdtemp`/UUID names, exact checkout revisions and
prepared frozen dependencies, never installs, never reads or copies user state,
and cleans both checkout runners and private state in `finally`.

Exact command, run twice:

```sh
TMPDIR=/var/tmp bun scripts/t3-v2-production/migration-acceptance.ts
TMPDIR=/var/tmp bun scripts/t3-v2-production/migration-acceptance.ts
```

Both runs exited 0. The repeated conclusive output was:

```text
old719a76 fixture: migration=52 messages=6 provider=1 history=1 turn=1
{"first":{"shell":{"importedThreadCount":1,"importedMessageCount":2},"transcript":{"importedThreadCount":1,"importedMessageCount":4},"eventCount":14,"messageCount":6},"second":{"shell":{"importedThreadCount":0,"importedMessageCount":0},"transcript":{"importedThreadCount":0,"importedMessageCount":0},"eventCount":14,"messageCount":6},"messages":6,"provider":"preserved","history":"preserved","turn":"preserved","v2Migration":54}
migration acceptance: PASS (fixture + migrate/import + restart/idempotency)
```

Each real JSON line additionally reported the generated source DB SHA-256
(`7581494e...4129` then `c16142b4...e43e`). It differs because the old
migration ledger records run time. Within each run the harness hashes immediately
before migration and asserts the source has the same hash after both current
passes. No owned runner, state directory, or process remained after either run.

## Packaging/runtime audit and fix

Reproduction before the fix, against a fresh candidate bundle/deploy:

```
TypeError: runCli is not a function
  at /var/tmp/die-v2-package/bootstrap.mjs:6
```

Owned source changes:

- `apps/server/src/bin.ts`: exported lazy explicit-argument `runCli` bridge.
- `apps/server/src/binCli.ts`: overload preserves ordinary `runCli()` behavior and adds `runCli(args): Promise<number>` using `Command.runWith` and `Runtime.defaultTeardown`.

Patch backup: `.agents/patches/t3-v2-production-migration-packaging.patch`, SHA-256 `caf9e64ab0a2b9af0c0d17e85d4f080e2ddb861cbacef44bbe56d631dd94b965`.

Validation after fix:

- `vp fmt` on both files: pass; `git diff --check`: pass.
- server `vp pack`: pass; built `bin.mjs` exports the bridge and lazy chunk.
- normal Node `node dist/bin.mjs --help`: exit 0.
- deployed package `bun bootstrap.mjs --help` with `PATH=/nonexistent`: exit 0 (no runtime node/npm lookup).
- live migration/start/restart used a PATH containing only sh/bash/fish/git/uname/sleep/mkdir/printenv, explicitly no node/bun/npm; external Bun was used only to model the Bun runtime embedded by the final Die executable. `node:sqlite` migration, server startup, shutdown reconciliation, and static serving worked.
- Stage symlink audit: no link resolved outside package root. T3 MIT license is copied. 171 dependency package manifests and 127 colocated LICENSE/COPYING/NOTICE files were present; Cursor’s platform package points to and ships the parent SDK `LICENSE.md`.
- Native stage is Linux x64-compatible and starts under Bun 1.4.1. It contains the expected Linux native assets (including fff/ffi) and also foreign prebuilds from bufferutil/utf-8-validate/node-pty. Those are archive bloat, not runtime lookup dependencies; native Bun PTY selection avoids loading node-pty in the embedded runtime.

Central `dist/release/THIRD_PARTY_LICENSES.txt` describes Die/Pi/Bun dependencies and does not aggregate every T3 backend dependency into one file. The backend archive does preserve published package notices plus `LICENSE-T3CODE`. This is adequate preservation evidence, not legal advice or a claim of a complete centralized SBOM.

## Non-owned/coordinator observations

- Whole server typecheck was blocked by a concurrent syntax error in `orchestration-v2/NativeDieIntegration.production.test.ts:486`; neither owned file produced a reported diagnostic, and bundle compilation passed.
- A combined native integration invocation had 38 passing tests and one failure because that test defaulted to nonexistent `/home/tnfssc/dist/die`. Use the coordinator-owned `T3_V2_DIE_BINARY=.../dist/die-t3-v2-root` after its concurrently edited test is syntactically coherent. This is not migration evidence.
- Final archive embedding/relocated compiled executable validation must be repeated by the coordinator when it intentionally creates `dist/die-t3-v2-candidate`. This worker did not race or replace the RPC-only root artifact.
