# Native delegated worktree implementation

## 2026-09-21 implementation in progress

Ownership is limited to the adopted T3 checkout at `.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e` and canonical `web/t3.patch`. No root CLI/task source is edited.

Implemented protocol direction (CLI worker must mirror these fields):

- launch input adds optional `title?: string`;
- launch input adds optional `workspace?: { kind: "inherit" } | { kind: "worktree"; baseRef?: string; branch?: string }`; omitted workspace is exactly `{ kind: "inherit" }`;
- launch result adds required `workspace`: inherit reports `{ kind: "inherit", preparationStatus: "ready" }`; worktree reports resolved stable `baseRef`, resolved stable `branch`, optional `worktreePath`, and `preparationStatus: "preparing" | "ready" | "failed"`.

Backend design now being validated:

- `delegated_task.request` remains the only lineage/result owner and persists the resolved workspace intent on the app-owned task.
- A worktree request creates the normal durable child, message and run, but uses a deferred/preparing run; it does not replace delegation with ordinary thread launch.
- Only after that transaction returns does the native service ask factored `ThreadLaunchService.prepare` to provision/setup/release the existing child run.
- The preparation command and generated branch are deterministic. Concurrent in-process replay is fenced by the existing preparation reservation. A replay after restart sees the already durable task and does not blindly rerun setup whose crash outcome may be uncertain.
- Delegated cancellation preserves created worktrees and branches. Existing project setup action semantics remain authoritative: synchronous actions wait; async/default-background actions release according to the existing runner. No approval/config system is added.

Validation still pending: typecheck repairs for registration test layers, focused contracts/backend tests, clean patch export/apply, canonical build, and native PiAdapter/Die smoke.

## Validation checkpoint

- Contracts typecheck and focused contract test pass (6 tests).
- Server typecheck and full 16-package workspace typecheck pass.
- Native backend tests pass (DieTaskService 6 tests, including deterministic branch/base resolution, deferred preparation, concurrent/restart replay fencing, and explicit uncertain crash status).
- Existing ThreadLaunch preparation lifecycle remains green (40 tests); orchestrator MCP integration passes (2 tests); production MCP registration smoke passes.
- Canonical patch exported reproducibly with a private temporary Git index: SHA-256 `dc7d45a010f0072cbb0e74397e1a304d4b9fc34d7d821076c620093b9a741621`, 94 paths. Private `/var/tmp` archive clean-apply and byte-for-byte patched-source comparison pass for all 94 paths.
- A fresh exact canonical build is in progress. The compiled Die/PiAdapter live worktree-path smoke must be coordinated with the CLI worker because the currently installed/root CLI protocol does not yet send the new structured fields. Existing inherit-path native acceptance can be rerun independently after build.

## Protocol compatibility correction

The result `workspace` field is **optional**, not required globally. It is present for `kind: "worktree"` launches (including status/path identity) and omitted for inherited launches so the already-adopted exact CLI bridge remains byte-shape compatible. The launch input remains optional/default-inherit. CLI worker should accept the optional result and require it when it requested worktree isolation. This correction followed a deterministic native smoke: the first run exposed the old exact bridge timing out on an added inherit-result field; no service/user state was retained.

## Coordinated live-smoke handoff

The backend harness service wiring issue found by the first smoke was fixed by providing the (unused for inherit) ThreadLaunch preparation service in `NativeDieIntegration.production.test.ts`. A second real PiAdapterV2 + compiled Die run reached the exact protocol boundary but timed out because the current root CLI worker build still advertises/validates the pre-worktree `die_task_launch` schema. This is the expected coordination gate: rerun the exact native acceptance only after the CLI worker consumes the input fields above and optional worktree result. Do not diagnose this second timeout as a provider/backend lifecycle failure. Focused backend, preparation, integration, typecheck and bundle gates remain passing.

## Final backend artifact checkpoint

Latest canonical patch supersedes the earlier incremental hash: `c49a877a6178bf8bd42d4a5bdea83d3399c6462a03c29d50ec371fe81b2c6733` (94 paths). Final clean apply from `a9b49a7df0a4261dcc438d4493cc3154a1d9819e` and byte comparison pass. Final exact canonical executable: `dist/die-t3-worktree-native-final`, SHA-256 `f7a5d11acbe221e4824a644697bcc8a794984f861fc3020dd36f68d78a8b884f`. Bundle and full workspace typecheck pass. Coordinated new-schema native acceptance remains assigned jointly with the CLI worker; current pre-schema CLI cannot complete that gate.
