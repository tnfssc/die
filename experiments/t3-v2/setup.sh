#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
RUNTIME="$SCRIPT_DIR/.runtime"
SOURCE="$RUNTIME/upstream"
LOCAL_UPSTREAM="$ROOT/.agents/research-t3-v2-pr2829"
CANONICAL_UPSTREAM="https://github.com/pingdotgg/t3code.git"
PIN="a9b49a7df0a4261dcc438d4493cc3154a1d9819e"
PATCH="$SCRIPT_DIR/upstream.patch"
DIE_BIN="${DIE_T3_DIE_BIN:-$ROOT/dist/die}"
command -v git >/dev/null || { echo "error: git is required" >&2; exit 1; }
command -v node >/dev/null || { echo "error: Node.js is required" >&2; exit 1; }
command -v corepack >/dev/null || { echo "error: corepack is required (no global pnpm install is used)" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "error: sha256sum is required" >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (!((major===22&&minor>=16)||(major===23&&minor>=11)||(major>=24))) process.exit(1)' || { echo "error: incompatible Node $(node --version)" >&2; exit 1; }
[[ -x "$DIE_BIN" ]] || { echo "error: Die binary is missing or not executable: $DIE_BIN" >&2; exit 1; }
die_checkout_clean=false
if git -C "$ROOT" diff --quiet -- && git -C "$ROOT" diff --cached --quiet --; then die_checkout_clean=true; fi
# An existing executable is content-addressed evidence, not proof it was built at HEAD.
die_revision="$(git -C "$ROOT" rev-parse HEAD)"
die_sha="$(sha256sum "$DIE_BIN" | cut -d' ' -f1)"

# Prefer the existing research mirror when it has the pin, but remain reproducible
# from a clean checkout by falling back to the canonical repository.
if [[ -n "${T3_V2_UPSTREAM_REPO:-}" ]]; then
  UPSTREAM_REPO="$T3_V2_UPSTREAM_REPO"
elif git -C "$LOCAL_UPSTREAM" cat-file -e "$PIN^{commit}" 2>/dev/null; then
  UPSTREAM_REPO="$LOCAL_UPSTREAM"
else
  UPSTREAM_REPO="$CANONICAL_UPSTREAM"
fi
patch_sha="none"
if [[ -f "$PATCH" ]]; then patch_sha="$(sha256sum "$PATCH" | cut -d' ' -f1)"; fi
wanted="$PIN $patch_sha"
mkdir -p "$RUNTIME" "$RUNTIME/home" "$RUNTIME/cache" "$RUNTIME/config" "$RUNTIME/data" "$RUNTIME/state" "$RUNTIME/pnpm-store" "$RUNTIME/logs"
current="$(cat "$RUNTIME/source.stamp" 2>/dev/null || true)"
if [[ ! -d "$SOURCE/.git" ]]; then
  stage="$RUNTIME/upstream.new.$$"
  [[ ! -e "$stage" ]] || { echo "error: staging path already exists: $stage" >&2; exit 1; }
  trap 'rm -rf -- "$stage"' EXIT
  echo "[setup] materializing pinned upstream $PIN from $UPSTREAM_REPO"
  # --no-local avoids hardlinks and --dissociate prevents an alternates dependency.
  git clone --quiet --no-checkout --no-local --dissociate "$UPSTREAM_REPO" "$stage"
  if ! git -C "$stage" cat-file -e "$PIN^{commit}" 2>/dev/null; then
    git -C "$stage" fetch --quiet origin "$PIN"
  fi
  git -C "$stage" cat-file -e "$PIN^{commit}" 2>/dev/null || {
    echo "error: pinned commit $PIN is unavailable from $UPSTREAM_REPO" >&2; exit 1;
  }
  git -C "$stage" -c advice.detachedHead=false checkout --quiet --detach "$PIN"
  if [[ -f "$PATCH" ]]; then
    git -C "$stage" apply --check "$PATCH"
    git -C "$stage" apply "$PATCH"
    echo "[setup] applied upstream.patch ($patch_sha)"
  elif [[ "${T3_V2_REQUIRE_PATCH:-0}" == 1 ]]; then
    echo "error: $PATCH is required but absent" >&2; exit 1
  else
    echo "[setup] upstream.patch absent; preparing the pinned baseline only"
  fi
  mv "$stage" "$SOURCE"
  trap - EXIT
  printf '%s
' "$wanted" > "$RUNTIME/source.stamp"
elif [[ "$current" != "$wanted" ]]; then
  echo "error: existing runtime does not match the requested pin/patch; wait for users to stop, then remove it explicitly" >&2
  exit 1
fi
[[ "$(git -C "$SOURCE" rev-parse HEAD)" == "$PIN" ]] || { echo "error: runtime source moved off pin" >&2; exit 1; }

# The patch is the tracked baseline. Probe-only integration tests may be copied or
# staged under orchestration-v2; all other tracked or untracked drift is rejected.
expected_diff_sha="$(if [[ -f "$PATCH" ]]; then sha256sum "$PATCH" | cut -d' ' -f1; else printf '' | sha256sum | cut -d' ' -f1; fi)"
actual_diff_sha="$(git -C "$SOURCE" diff --binary HEAD -- . ':(exclude)apps/server/src/orchestration-v2/Adapters/combinedPiDie.integration.test.ts' ':(exclude)apps/server/src/orchestration-v2/Adapters/clockPiRpc.integration.test.ts' ':(exclude)apps/server/src/orchestration-v2/testkit/integratedRealPiDie.integration.test.ts' ':(exclude)apps/server/src/orchestration-v2/testkit/integratedRealHarness.ts' ':(exclude)apps/server/src/orchestration-v2/testkit/OrchestratorReplayFixtures.integration.test.ts' | sha256sum | cut -d' ' -f1)"
[[ "$actual_diff_sha" == "$expected_diff_sha" ]] || { echo "error: runtime tracked tree differs from the patched baseline" >&2; exit 1; }
while IFS= read -r line; do
  path="${line:3}"
  [[ "${line:0:2}" != "??" ]] && continue # tracked content is covered by the digest
  case "$path" in
    apps/server/src/orchestration-v2/Adapters/combinedPiDie.integration.test.ts|apps/server/src/orchestration-v2/Adapters/clockPiRpc.integration.test.ts|apps/server/src/orchestration-v2/testkit/integratedRealPiDie.integration.test.ts|apps/server/src/orchestration-v2/testkit/integratedRealHarness.ts) continue ;;
  esac
  echo "error: unexpected runtime source status: $line" >&2; exit 1
done < <(git -C "$SOURCE" status --porcelain=v1 --untracked-files=all)
status_sha="$(git -C "$SOURCE" status --porcelain=v1 --untracked-files=all | awk '!/^.. apps\/server\/src\/orchestration-v2\/.*\.integration\.test\.ts$/' | sha256sum | cut -d' ' -f1)"

old_die_sha="$(sed -n 's/^die_binary_sha256=//p' "$RUNTIME/setup-info.txt" 2>/dev/null || true)"
old_die_revision="$(sed -n 's/^die_source_revision=//p' "$RUNTIME/setup-info.txt" 2>/dev/null || true)"
[[ -z "$old_die_sha" || "$old_die_sha" == "$die_sha" ]] || { echo "error: Die binary changed since setup metadata was recorded" >&2; exit 1; }
[[ -z "$old_die_revision" || "$old_die_revision" == "$die_revision" ]] || { echo "error: Die source revision changed since setup metadata was recorded" >&2; exit 1; }
export HOME="$RUNTIME/home" XDG_CACHE_HOME="$RUNTIME/cache" XDG_CONFIG_HOME="$RUNTIME/config" XDG_DATA_HOME="$RUNTIME/data" XDG_STATE_HOME="$RUNTIME/state/xdg"
export COREPACK_HOME="$RUNTIME/cache/corepack" npm_config_cache="$RUNTIME/cache/npm"
cd "$SOURCE"
echo "[setup] installing pnpm-locked dependencies into isolated runtime"
corepack pnpm install --frozen-lockfile --store-dir "$RUNTIME/pnpm-store"
printf 'pin=%s
patch_sha256=%s
source_head_tree=%s
source_worktree_sha256=%s
source_status_sha256=%s
die_source_revision=%s
die_checkout_tracked_clean=%s
die_binary_source_provenance=unverified-existing-artifact
die_binary=%s
die_binary_sha256=%s
node=%s
pnpm=%s
' \
  "$PIN" "$patch_sha" "$(git rev-parse HEAD^{tree})" "$actual_diff_sha" "$status_sha" "$die_revision" "$die_checkout_clean" "$DIE_BIN" "$die_sha" "$(node --version)" "$(corepack pnpm --version)" > "$RUNTIME/setup-info.txt"
echo "[setup] ready: $SOURCE"
