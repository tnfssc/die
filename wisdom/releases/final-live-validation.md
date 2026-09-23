# Final live validation

Date (UTC): 2026-09-21

## Verdict

**Blocked overall:** six requested gates passed. The packaged relocation and security smoke failed both times. The smoke harness got no response to its same-origin raw WebSocket upgrade before the 10-second timeout. It turns that request error into status `0` and fails with `same-origin WebSocket rejected (0)`. The retry produced the same result. A temporary untracked diagnostic harness showed `WebSocket upgrade timed out`. Both packaged runs had already passed HTTP startup, migrations, same-origin no-auth HTTP, and local HTTP without headers. The separate backend stayed healthy. Browser, worktree, native, and preservation checks that use WebSockets all passed. The blocker is limited to the packaged smoke raw-upgrade path with relocation and an empty PATH. It is not a binary hash, manifest, startup, or general browser connection mismatch. No harness or source fix was made. Main owns code changes.

## Exact candidate and provenance

- Binary: `/home/tnfssc/Code/die/dist/die`
- SHA-256 before and after gates: `5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1`
- Size/mode: 165373408 bytes, mode 0755
- Canonical checkout: `/home/tnfssc/Code/die/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e`
- Checkout HEAD: `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`
- Canonical patch SHA-256: `973b265252c61b33d056c51da8ce15d628f3fa7632fde31af63fd8e08399b686`
- Final index tree, unchanged by this harness-only work: `7e672cc2180ef7075e49fce65eff604764c78b6b`
- Generated packaged manifest: `artifacts/final-pr/final-live-build-manifest.json`. The harness parses this file as JSON and requires `executableHash ?? binarySha256` to equal the candidate hash. The generated manifest uses `binarySha256` and additionally records binary path, patch hash, revision, binary mtime, and manifest generation time.
- This run did not build, install, replace an executable, edit source, touch the index, commit, or change user state. The repository already had staged and unstaged changes before this run. Only evidence under `artifacts/final-pr` and this requested note were created. The only diagnostic copy was `/var/tmp/die-packaged-smoke-debug.ts` and was removed; its isolated temp directory was also removed.

## Results

| Gate | Result | Evidence |
|---|---|---|
| Contract conformance | PASS | `artifacts/final-pr/final-live-contract.log` |
| Worktree acceptance | PASS | `artifacts/final-pr/worktree/proof.json`, `final-live-worktree.log` |
| Native acceptance | PASS | `artifacts/final-pr/native/proof.json`, `final-live-native.log` |
| Packaged smoke | **FAIL (blocking, reproduced twice)** | `packaged-proof-attempt1-failure.json`, `packaged-proof-attempt2-failure.json`, `final-live-packaged*.log` |
| Packaged diagnostic | Confirms 10-second WebSocket upgrade timeout | `packaged-debug-proof.json`, `final-live-packaged-debug.log` |
| Preservation acceptance | PASS | `preservation-proof.json`, `final-live-preservation.log` |
| Browser acceptance | PASS | `browser/proof.json`, screenshots, `final-live-browser.log` |
| Migration acceptance | PASS | `final-live-migration.log` |

Every passing check that used the binary records SHA-256 `5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1`. Native teardown reports all owned PIDs reaped; a final independent `/proc` check found none of the native/browser owned PIDs alive. Final hashes, HEAD, index/status, executable stat, and temp inventory are in `artifacts/final-pr/final-live-provenance.log`.

## Exact commands

All commands ran from `/home/tnfssc/Code/die`. The logs keep these command lines exactly.

### Contract

```bash
TMPDIR=/var/tmp T3_V2_CANDIDATE="$PWD/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e" \
  bun scripts/t3-v2-production/contract-conformance.ts
```

### Worktree

```bash
TMPDIR=/var/tmp T3_WORKTREE_ACCEPT=1 T3_WORKTREE_DIE_BINARY="$PWD/dist/die" \
T3_WORKTREE_EXPECT_SHA256=5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1 \
T3_V2_CANDIDATE="$PWD/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e" \
T3_V2_EXPECT_CHECKOUT_HEAD=a9b49a7df0a4261dcc438d4493cc3154a1d9819e \
T3_WORKTREE_PROOF="$PWD/artifacts/final-pr/worktree/proof.json" \
bun scripts/t3-v2-production/worktree-acceptance.ts
```

### Native

```bash
TMPDIR=/var/tmp T3_V2_ACCEPT_CANDIDATE=1 T3_V2_DIE_BINARY="$PWD/dist/die" \
T3_V2_EXPECT_BINARY_SHA256=5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1 \
T3_V2_CANDIDATE="$PWD/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e" \
T3_V2_EXPECT_CHECKOUT_HEAD=a9b49a7df0a4261dcc438d4493cc3154a1d9819e \
T3_V2_NATIVE_ARTIFACTS="$PWD/artifacts/final-pr/native" \
bun scripts/t3-v2-production/native-acceptance.ts
```

### Packaged smoke (both failed attempts used this exact command)

```bash
TMPDIR=/var/tmp T3_V2_PACKAGED_BINARY="$PWD/dist/die" \
T3_V2_EXPECT_BINARY_SHA256=5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1 \
T3_V2_PACKAGED_MANIFEST="$PWD/artifacts/final-pr/final-live-build-manifest.json" \
T3_V2_PACKAGED_PROOF="$PWD/artifacts/final-pr/packaged-proof.json" \
bun scripts/t3-v2-production/packaged-smoke.ts
```

The temporary diagnostic used the same environment plus `T3_V2_KEEP_TEMP=1` and `bun /var/tmp/die-packaged-smoke-debug.ts`; the only diagnostic change was logging the harness's otherwise-swallowed request error. It produced `WebSocket upgrade timed out`. The saved debug proof is evidence only. Temporary files and state were removed afterward.

### Preservation

```bash
TMPDIR=/var/tmp T3_V2_ACCEPT_CANDIDATE=1 T3_V2_PACKAGED_BINARY="$PWD/dist/die" \
T3_V2_EXPECT_BINARY_SHA256=5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1 \
T3_V2_CANDIDATE="$PWD/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e" \
T3_V2_PRESERVATION_PROOF="$PWD/artifacts/final-pr/preservation-proof.json" \
bun scripts/t3-v2-production/preservation-acceptance.ts
```

### Browser

```bash
TMPDIR=/var/tmp T3_V2_ACCEPT_CANDIDATE=1 T3_V2_DIE_BINARY="$PWD/dist/die" \
T3_V2_EXPECT_BINARY_SHA256=5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1 \
T3_V2_CANDIDATE="$PWD/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e" \
T3_V2_EXPECT_CHECKOUT_HEAD=a9b49a7df0a4261dcc438d4493cc3154a1d9819e \
T3_V2_PLAYWRIGHT_ROOT="$PWD/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core" \
T3_V2_CHROMIUM="$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome" \
T3_V2_BROWSER_ARTIFACTS="$PWD/artifacts/final-pr/browser" \
bun scripts/t3-v2-production/browser-acceptance.ts
```

### Migration

```bash
TMPDIR=/var/tmp \
T3_V2_CANDIDATE="$PWD/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e" \
T3_V2_MIGRATION_PATCH="$PWD/web/t3.patch" \
bun scripts/t3-v2-production/migration-acceptance.ts
```

## Caveats

- Packaged smoke still blocks the release even though the other gates passed. Do not treat the overall suite as accepted.
- Contract and migration check source and state. They do not use the executable. They ran against the exact canonical checkout and patch tied to the binary checks.
- Unrelated `/var/tmp/die-t3-v2-preservation-*` directories and old long-running `dist/die web` processes were present. This run did not own them, so it left them alone. Every process and temp directory started by these harness runs was removed.
