#!/usr/bin/env bash
# Launch the pinned experiment UI with its own ports and durable state.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
RUNTIME="$HERE/.runtime"
SOURCE="$RUNTIME/upstream"
"$HERE/run.sh" verify >/dev/null
OFFSET="${T3_BROWSER_LIVE_OFFSET:-25000}"
[[ "$OFFSET" =~ ^[0-9]{1,5}$ ]] || { echo "invalid browser offset" >&2; exit 1; }
OFFSET=$((10#$OFFSET)); WEB_PORT=$((5733 + OFFSET)); SERVER_PORT=$((13773 + OFFSET))
(( SERVER_PORT <= 65535 )) || { echo "browser offset too large" >&2; exit 1; }
export HOME="$RUNTIME/browser-live-home"
export XDG_CACHE_HOME="$RUNTIME/browser-live-cache"
export XDG_CONFIG_HOME="$RUNTIME/browser-live-config"
export XDG_DATA_HOME="$RUNTIME/browser-live-data"
export XDG_STATE_HOME="$RUNTIME/browser-live-final-state/xdg"
export COREPACK_HOME="$RUNTIME/cache/corepack" npm_config_cache="$RUNTIME/cache/npm"
export T3CODE_PORT_OFFSET="$OFFSET"
export T3CODE_HOME="$RUNTIME/browser-live-final-state/t3-home"
export T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=false
mkdir -p "$T3CODE_HOME" "$RUNTIME/browser-live-logs"
cd "$SOURCE"
echo "[browser-live] UI http://localhost:$WEB_PORT backend $SERVER_PORT state $T3CODE_HOME"
exec corepack pnpm exec node scripts/dev-runner.ts dev --home-dir "$T3CODE_HOME" --host 127.0.0.1 --port "$SERVER_PORT" --dev-url "http://localhost:$WEB_PORT"
