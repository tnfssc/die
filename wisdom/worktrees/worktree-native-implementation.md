# Native delegated worktree implementation

## 2026-09-21 implementation in progress

This work owned only the adopted T3 checkout at `.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e` and canonical `web/t3.patch`. It did not edit root CLI or task source.

Built protocol direction (CLI worker must mirror these fields):

- launch input adds optional `title?: string`;
- launch input adds optional `workspace?: { kind: "inherit" } | { kind: "worktree"; baseRef?: string; branch?: string }`. Omitted workspace is exactly `{ kind: "inherit" }`;
- launch result adds required `workspace`: inherit reports `{ kind: "inherit", preparationStatus: "ready" }`. Worktree reports resolved stable `baseRef`, resolved stable `branch`, optional `worktreePath`, and `preparationStatus: "preparing" | "ready" | "failed"`.

Backend design now being validated:

- `delegated_task.request` is still the only lineage/result owner and persists the resolved workspace intent on the app-owned task.
- A worktree request creates the normal durable child, message, and run with a deferred/preparing run. It does not replace delegation with ordinary thread launch.
- Only after that transaction returns does the native service ask factored `ThreadLaunchService.prepare` to provision/setup/release the existing child run.
- The preparation command and generated branch are deterministic. Concurrent in-process replay is fenced by the existing preparation reservation. A replay after restart sees the already durable task and does not blindly rerun setup whose crash outcome may be uncertain.
- Delegated cancellation preserves created worktrees and branches. Existing project setup action semantics stay authoritative: synchronous actions wait. Async/default-background actions release according to the existing runner. No approval/config system is added.

Validation still pending: typecheck repairs for registration test layers, focused contracts/backend tests, clean patch export/apply, canonical build, and native PiAdapter/Die smoke.

## Validation checkpoint

- Contracts typecheck and focused contract test pass (6 tests).
- Server typecheck and full 16-package workspace typecheck pass.
- Native backend tests pass (DieTaskService 6 tests, including deterministic branch/base resolution, deferred preparation, concurrent/restart replay fencing, and explicit uncertain crash status).
- Existing ThreadLaunch preparation lifecycle is still green (40 tests). Orchestrator MCP integration passes (2 tests). Production MCP registration smoke passes.
- Canonical patch exported reproducibly with a private temporary Git index: SHA-256 `dc7d45a010f0072cbb0e74397e1a304d4b9fc34d7d821076c620093b9a741621`, 94 paths. Private `/var/tmp` archive clean-apply and byte-for-byte patched-source comparison pass for all 94 paths.
- A fresh exact canonical build is in progress. The compiled Die/PiAdapter live worktree-path smoke must be coordinated with the CLI worker because the now installed/root CLI protocol does not yet send the new structured fields. Existing inherit-path native acceptance can be rerun independently after build.

## Protocol compatibility correction

The result `workspace` field is **optional**, not required globally. It is present for `kind: "worktree"` launches (including status/path identity) and omitted for inherited launches so the already-adopted exact CLI bridge is still byte-shape compatible. The launch input is still optional/default-inherit. CLI worker should accept the optional result and require it when it requested worktree isolation. This correction followed a deterministic native smoke: the first run exposed the old exact bridge timing out on an added inherit-result field. No service/user state was retained.

## Coordinated live-smoke handoff

The first smoke found missing backend harness wiring. Fix it by providing the ThreadLaunch preparation service in `NativeDieIntegration.production.test.ts`, even though inherit does not use it. A second run with real PiAdapterV2 and compiled Die reached the protocol boundary. It timed out because the current root CLI worker still advertises and validates the old `die_task_launch` schema without worktree fields. Treat that as the expected coordination gate, not a provider or backend lifecycle failure. Rerun the same native acceptance after the CLI worker accepts the fields above and the optional worktree result. Focused backend, preparation, integration, typecheck, and bundle gates still pass.

## Final backend artifact checkpoint

Latest canonical patch supersedes the earlier incremental hash: `c49a877a6178bf8bd42d4a5bdea83d3399c6462a03c29d50ec371fe81b2c6733` (94 paths). Final clean apply from `a9b49a7df0a4261dcc438d4493cc3154a1d9819e` and byte comparison pass. Final exact canonical executable: `dist/die-t3-worktree-native-final`, SHA-256 `f7a5d11acbe221e4824a644697bcc8a794984f861fc3020dd36f68d78a8b884f`. Bundle and full workspace typecheck pass. Coordinated new-schema native acceptance is still assigned jointly with the CLI worker. Current pre-schema CLI cannot complete that gate.
