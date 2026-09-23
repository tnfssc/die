# Native worktree corrective fixes

## 2026-09-21 backend ownership

- Canonical source: `.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e` (source revision `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`).
- `DieTaskService` now resolves the parent thread's actual worktree cwd (or project workspace root) with argv-only `git rev-parse --verify --end-of-options <ref>^{commit}` before the durable delegation dispatch. Both omitted `baseRef` and explicit Git revision expressions become validated 40/64-hex OIDs. It no longer uses the projected branch as a base.
- Durable delegated workspace state records request identity plus the original optional `baseRef`/`branch` semantics. Replay finds that record, compares semantic input, and reuses its pinned OID without resolving a moved HEAD/ref. Public task workspace output does not change and does not expose replay metadata.
- Worktree preparation ownership is atomically claimed, preventing concurrent replay from scheduling setup twice. A bounded detached watcher removes ownership when the deferred run leaves `preparing`. Observe/list also clean terminal ownership and cancel deletes it immediately. Fresh-process replay is still `uncertain` and never blindly retries setup. The durable deferred child/run is still the only graph owner.
- Git-backed service coverage now checks default HEAD pinning despite stale projected branch, moving-HEAD replay, a later explicit same-pinned sibling launch, and concurrent replay at-most-once preparation. Git VCS coverage checks a colliding branch fails without moving/resetting that branch or parent HEAD.
- The canonical server TypeScript check passed with the dependency tree already present. Nothing was built, installed, or launched. A focused Vitest run used the other cache's dependency symlink. But that noncanonical module layout caused Vitest/@effect-vitest fixture-registration errors before tests began. The coordinator still needed to run the focused files in the exact final dependency workspace.
- Exported all preserved canonical changes to `web/t3.patch` with an isolated private Git index. SHA-256: `9e94ef5ed37484631f2706dab4832f3c696b6b0395e3f182ada7547660105ca4`. A second private-index generation matched byte-for-byte, and an archive of source HEAD passed `git apply --check --binary` plus application.
- One accidental `pnpm exec` attempt triggered pnpm's dependency-status install check. But pnpm aborted before installation because no TTY. Its candidate `node_modules` residue was removed. No installed or compiled artifact remains.

## Coordinator final integration correction

The final design has no detached watcher. DieTaskService asks ThreadLaunchService.isPreparing(commandId) instead. That reuses the existing scoped reservation and cleanup, with no extra task-ID set or polling fiber. The malformed it.scoped registration is fixed. The focused backend suites pass 49 tests, the Git driver suite passes 99, and the final terminal log suite passes 85. See worktree-feature-implementation.md for later canonical hashes and build identity.
