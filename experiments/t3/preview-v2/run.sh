#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
RUNTIME="$SCRIPT_DIR/.runtime"; SOURCE="$RUNTIME/upstream"
PIN="a9b49a7df0a4261dcc438d4493cc3154a1d9819e"
PATCH="$SCRIPT_DIR/upstream.patch"
OFFSET="${T3_V2_PORT_OFFSET:-19000}"
MODE="${1:-dev}"; shift || true
[[ "$OFFSET" =~ ^[0-9]{1,5}$ ]] || { echo "error: T3_V2_PORT_OFFSET must be a non-negative integer" >&2; exit 1; }
OFFSET=$((10#$OFFSET)); WEB_PORT=$((5733 + OFFSET)); SERVER_PORT=$((13773 + OFFSET))
(( OFFSET >= 0 && WEB_PORT <= 65535 && SERVER_PORT <= 65535 )) || { echo "error: invalid T3_V2_PORT_OFFSET=$OFFSET" >&2; exit 1; }
if [[ "$MODE" == dev || "$MODE" == dry-run ]]; then
  (($# == 0)) || { echo "error: dev/dry-run do not accept overrides; use T3_V2_PORT_OFFSET" >&2; exit 2; }
fi
[[ -d "$SOURCE/node_modules" ]] || { echo "error: run $SCRIPT_DIR/setup.sh first" >&2; exit 1; }
[[ "$(git -C "$SOURCE" rev-parse HEAD)" == "$PIN" ]] || { echo "error: runtime source is not at pinned commit" >&2; exit 1; }
expected_diff_sha="$(if [[ -f "$PATCH" ]]; then sha256sum "$PATCH" | cut -d' ' -f1; else printf '' | sha256sum | cut -d' ' -f1; fi)"
actual_diff_sha="$(git -C "$SOURCE" diff --binary HEAD -- . ':(exclude)apps/server/src/orchestration-v2/Adapters/combinedPiDie.integration.test.ts' ':(exclude)apps/server/src/orchestration-v2/Adapters/clockPiRpc.integration.test.ts' ':(exclude)apps/server/src/orchestration-v2/testkit/integratedRealPiDie.integration.test.ts' ':(exclude)apps/server/src/orchestration-v2/testkit/integratedRealHarness.ts' ':(exclude)apps/server/src/orchestration-v2/testkit/OrchestratorReplayFixtures.integration.test.ts' | sha256sum | cut -d' ' -f1)"
[[ "$actual_diff_sha" == "$expected_diff_sha" ]] || { echo "error: runtime tracked tree differs from the patched baseline" >&2; exit 1; }
while IFS= read -r line; do
  path="${line:3}"
  [[ "${line:0:2}" != "??" ]] && continue
  case "$path" in
    apps/server/src/orchestration-v2/Adapters/combinedPiDie.integration.test.ts|apps/server/src/orchestration-v2/Adapters/clockPiRpc.integration.test.ts|apps/server/src/orchestration-v2/testkit/integratedRealPiDie.integration.test.ts|apps/server/src/orchestration-v2/testkit/integratedRealHarness.ts) continue ;;
  esac
  echo "error: unexpected runtime source status: $line" >&2; exit 1
done < <(git -C "$SOURCE" status --porcelain=v1 --untracked-files=all)
export HOME="$RUNTIME/home" XDG_CACHE_HOME="$RUNTIME/cache" XDG_CONFIG_HOME="$RUNTIME/config" XDG_DATA_HOME="$RUNTIME/data" XDG_STATE_HOME="$RUNTIME/state/xdg"
export COREPACK_HOME="$RUNTIME/cache/corepack" npm_config_cache="$RUNTIME/cache/npm" T3CODE_PORT_OFFSET="$OFFSET"
export T3CODE_HOME="$RUNTIME/state/t3-home" T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=false
mkdir -p "$T3CODE_HOME" "$RUNTIME/logs"; cd "$SOURCE"
case "$MODE" in
  verify) echo "verified pinned patched experiment source" ;;
  dev)
    echo "[run] UI: http://localhost:$WEB_PORT (backend $SERVER_PORT; loopback only)"
    exec corepack pnpm exec node scripts/dev-runner.ts dev --home-dir "$T3CODE_HOME" --host 127.0.0.1 --port "$SERVER_PORT" --dev-url "http://localhost:$WEB_PORT" "$@" ;;
  dry-run)
    exec corepack pnpm exec node scripts/dev-runner.ts dev --home-dir "$T3CODE_HOME" --host 127.0.0.1 --port "$SERVER_PORT" --dev-url "http://localhost:$WEB_PORT" --dry-run "$@" ;;
  test-harness)
    exec corepack pnpm exec vp test run apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts -t "delegates cross-provider tasks with exactly-once reconnect, status, results, graph, and cancel" ;;
  test-ui)
    if (($#)); then exec corepack pnpm exec vp test run "$@"; fi
    exec corepack pnpm exec vp test run apps/web/src/components/chat/ThreadRelationshipsControl.agents.test.tsx apps/web/src/components/chat/agentSpawnSummary.test.ts apps/web/src/lib/orchestrationV2Timeline.test.ts ;;
  *) echo "usage: $0 {verify|dev|dry-run|test-ui|test-harness} [arguments...]" >&2; exit 2 ;;
esac
