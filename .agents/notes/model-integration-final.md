# Model integration final

## Canonical source and artifact

- Canonical checkout: `/home/tnfssc/Code/die/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e`.
- Pinned upstream HEAD: `a9b49a7df0a4261dcc438d4493cc3154a1d9819e` (unchanged).
- Integrated incremental input: `.agents/patches/last-used-model-incremental.patch`, SHA-256 `3322fbb4399ecb1d0c0035a481e1c1889239823872c9cb31c63c76c9ba8e3024`.
- Final canonical `web/t3.patch`: SHA-256 `973b265252c61b33d056c51da8ce15d628f3fa7632fde31af63fd8e08399b686`, 100 paths, clean-apply verified.
- Running the private-index exporter twice produced the same hash. The canonical and root indexes remain untouched.

The five incremental files are `DraftHeroHeadline.tsx`, `composerDraftStore.test.ts`, `useHandleNewThread.ts`, `chatThreadActions.test.ts`, and `chatThreadActions.ts`. Existing workspace/native source remained in the canonical checkout. No root CLI/docs source or index was edited.

## Behavior and coverage review

The integrated precedence is explicit project pin > explicit composer carry > persisted last explicit picker selection > environment fallback. A resumed thread's historical model no longer overwrites new-thread intent. Existing/resumed thread selections remain unchanged, and provider identity is preserved.

Stable tests now cover resumed A versus sticky B for both blank and worktree drafts, later explicit C, persisted-store rehydration, non-explicit resumed carry, environment fallback, explicit carry, and explicit project-pin precedence. The earlier claim that Die CI already ran the complete `@t3tools/web` unit suite was incorrect: it confused upstream T3 CI with this repository's workflow. Die CI now explicitly runs the two focused model test files from `apps/web` with the `unit` project.

## Dependency-consistent validation

The prior worker's shared dependency tree was stale. I resolved it in the pinned canonical checkout with:

`CI=true corepack pnpm install --frozen-lockfile`

This used the declared pnpm 11.10.0, accepted the pinned lockfile, reused cached packages (0 downloaded), and ran the repository prepare hook. The successful tests below ran afterward against that checkout. An earlier root-level focused invocation failed before collecting tests because `--project unit` must be run from `apps/web`; it is not counted as a pass.

Passed:

- Focused model tests from `apps/web`: 2 files, **158 tests**.
- Full `@t3tools/web` unit suite: **407 files, 5415 tests**.
- Full upstream monorepo typecheck: 15 tasks / all 16 workspace projects, exit 0 (existing Effect diagnostic suggestions only).
- Focused five-file lint: pass.
- Focused five-file format check: pass.
- Canonical `git diff --check`: pass.
- Root `bun run check`: pass.
- Root `bun test tests/web-source.test.ts`: 1 pass; exact patch and untouched-index verification.
- Canonical export twice: identical hash and clean apply.

## Caveats and final build acceptance

The current `dist/die-worktree-production` and `dist/worktree-production-build.json` predate this model patch (their manifest names old patch hash `62d760...`). They must not be accepted as the final candidate. No executable was rebuilt, installed, committed, or pushed in this integration task. Prior native/worktree proofs remain valuable regression evidence but are not same-binary evidence for the new patch hash. Final acceptance must rebuild and rerun the candidate gates.

From repository root, use:

```bash
CANON="$PWD/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e"
HEAD=a9b49a7df0a4261dcc438d4493cc3154a1d9819e

# Reconfirm canonical export, then build a new uninstalled candidate.
bun scripts/t3-v2-production/export-worktree.ts
bun run build:web
bun scripts/build.ts --reuse-web --outfile=dist/die-worktree-production

BIN="$PWD/dist/die-worktree-production"
SHA=$(sha256sum "$BIN" | cut -d' ' -f1)
PATCH_SHA=$(sha256sum web/t3.patch | cut -d' ' -f1)
printf 'binary=%s\nsha256=%s\npatch=%s\nhead=%s\n' "$BIN" "$SHA" "$PATCH_SHA" "$HEAD"
```

Create/update `dist/worktree-production-build.json` with that exact absolute binary path, `binarySha256`, `patchSha256`, revision, and build time before packaged smoke. Then run the same-hash gates:

```bash
T3_WORKTREE_ACCEPT=1 T3_WORKTREE_DIE_BINARY="$BIN" \
T3_WORKTREE_EXPECT_SHA256="$SHA" T3_V2_EXPECT_CHECKOUT_HEAD="$HEAD" \
bun scripts/t3-v2-production/worktree-acceptance.ts

T3_V2_ACCEPT_CANDIDATE=1 T3_V2_DIE_BINARY="$BIN" \
T3_V2_EXPECT_BINARY_SHA256="$SHA" T3_V2_EXPECT_CHECKOUT_HEAD="$HEAD" \
bun scripts/t3-v2-production/native-acceptance.ts

T3_V2_PACKAGED_BINARY="$BIN" T3_V2_EXPECT_BINARY_SHA256="$SHA" \
T3_V2_PACKAGED_MANIFEST="$PWD/dist/worktree-production-build.json" \
T3_V2_PACKAGED_PROOF="$PWD/artifacts/worktree-packaged-smoke.json" \
bun scripts/t3-v2-production/packaged-smoke.ts

T3_V2_ACCEPT_CANDIDATE=1 T3_V2_PACKAGED_BINARY="$BIN" \
T3_V2_EXPECT_BINARY_SHA256="$SHA" T3_V2_CANDIDATE="$CANON" \
T3_V2_PRESERVATION_PROOF="$PWD/artifacts/worktree-preservation-acceptance.json" \
bun scripts/t3-v2-production/preservation-acceptance.ts
```
