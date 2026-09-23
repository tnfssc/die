# Adopted T3 preview package, relocation, origin, and terminal acceptance

**Run:** 2026-09-22 08:31–08:47 UTC  
**Result:** PASS for package/security/terminal scope. No release, version, tag, push, or installation was performed.

## Exact adopted inputs and persistent locations

- Die worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_e57389e4`
- Die branch: `die/preview-packaging-and-relocated-security-e57389e4`
- Starting adoption commit: `51f8f7d`
- Owned T3 checkout/cache: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_e57389e4/.cache/t3-preview-packaging-source`
- Owned checkout branch: `die-preview-probe` (independent nested clone; no shared Git metadata)
- Read-only seed used only as clone input: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_8a2c4ca2-a86675007a5e-task_02d7b006/.cache/t3-preview-candidate`
- T3 revision: `b488c57f3f9f1688e31c53daee99e29dd1d0baa2`
- Adopted patch SHA-256: `1c879cb723de12b3803b11c1772b9688267f65ee52d855f20fd7f658fcf9f4a0`
- Dependencies and pnpm/Bun stores are private to `.cache/t3-preview-packaging-env`; the seed and parent/shared candidate caches were not mutated.

A post-build `verifyWebSource(ownedCheckout, canonicalPatch)` passed with exactly the canonical 103-path projection.

## Actual package outputs

`scripts/build-web.ts` itself ran successfully with `DIE_T3_SOURCE` set to the owned checkout. This exercised frozen pnpm install, patched backend typecheck, web build, server bundle, legacy production deploy, self-reference repair, portable ffi-rs optional-dependency verification, license/source outputs, bootstrap injection, and archive packing. It was not replaced by an upstream workspace-only build.

- Browser-test binary: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_e57389e4/dist/die-t3-preview-adopted`
  - bytes: `200472032`
  - SHA-256: `516ebaa6d7dfad1bdd67ae8fe4bea339fdcc586bdb0193329c42eee69f977da5`
- Web runtime archive: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_e57389e4/dist/die-web.archive.gz`
  - SHA-256/content ID: `43e4839f8d611fc66d51cfc4dcebbdc17354a34c21046e7639e777b45e01d63d`
- Build manifest: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83-a86675007a5e-task_e57389e4/dist/t3-preview-adopted-build.json`
  - SHA-256: `9c28446713005f93d4feef567fc9a788925fb6457d88297ae3c1a1cc516fca7a`
- Extracted bootstrap SHA-256: `154fc94a56be176ef6f4e6591f594a5834fd81bc2afe101442cc0b8d6364ebc2`

The first actual build invocation reached pnpm install but transient registry download/write errors left `@effect/tsgo-linux-x64` unavailable to the workspace prepare hook. Re-running the same `scripts/build-web.ts` invocation against the same owned checkout/store fetched the ten missing optional packages and completed. No source relaxation, skipped typecheck, shared-cache reuse, or manual deploy substitution was used.

## Relocated package and no-auth Host/Origin security

`scripts/t3-v2-production/packaged-smoke.ts` was run with the exact binary and manifest hashes pinned above. Evidence:

- `artifacts/t3-preview-package/packaged-smoke.json` (SHA-256 `b956d9e811541efba82d4b9d12d9b3df982b828f42d47e26c2531dfe3a9c2fec`)
- `artifacts/t3-preview-package/packaged-smoke.log`

PASS: the binary was copied, renamed, and launched from a private path containing spaces with a deliberately nonexistent runtime PATH. Both launcher and backend executed the relocated package binary; no external node/npm/npx/bun process was present. The extracted runtime directory was the archive content ID above. SIGTERM returned launcher status 143 and all exact owned PIDs disappeared.

HTTP no-auth accepted exact same-origin and headerless local requests. It returned `authenticated:false` for cross-origin, opaque-origin, wrong-port, alternate-host, DNS-rebinding Host, and cross-site requests. WebSocket protocol v2 returned 101 for exact same-origin and headerless local upgrades and did not upgrade cross-origin, wrong-port, alternate-host, or rebinding-Host requests. Existing nested provider/settings/model metadata survived relocation; only Pi `binaryPath` was changed to the relocated package as intended.

## Terminal/package preservation

`scripts/t3-v2-production/preservation-acceptance.ts` was run against the same pinned relocated binary, the owned candidate checkout, and Chromium 1228. Evidence:

- `artifacts/t3-preview-package/preservation-acceptance.json` (SHA-256 `1c1fbb2dcaea4aa78d87334e72b71f80e466fab60864acc55c7c564d30fa9948`)
- `artifacts/t3-preview-package/preservation-acceptance.log`

PASS: production browser WebSocket terminal APIs handled delayed input/output (1,000 ms delay, unique PTY marker), terminal canvas resize (300x150 to 914x279), isolated runtime model settings, observable running execute-shell card, pending local-shell liveness after handoff, and pending-shell history after reload. This is package/terminal preservation evidence, not native delegation lifecycle or general browser UX ownership. The harness explicitly does not prove compaction, token/cost accounting, or mode-switch history.

## Scope boundary

This task covers the actual archive/deploy, relocated-runtime substrate, no-auth HTTP/WS Host/Origin boundary, and packaged terminal preservation. It does not cover the separately owned native root/child lifecycle or broader live-browser acceptance gates.
