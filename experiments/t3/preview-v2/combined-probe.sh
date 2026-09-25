#!/usr/bin/env bash
# Real adapter/Die + explicitly mock MCP transport regression. No paid model.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE="$HERE/.runtime/upstream"
TARGET="$SOURCE/apps/server/src/orchestration-v2/Adapters/combinedPiDie.integration.test.ts"
command -v timeout >/dev/null || { echo "error: GNU timeout required" >&2; exit 1; }
[[ -d "$SOURCE/node_modules" ]] || { echo "error: run setup.sh first" >&2; exit 1; }
[[ ! -e "$TARGET" ]] || { echo "error: diagnostic target already exists; refusing overwrite" >&2; exit 1; }
mkdir -p "$HERE/.runtime/logs"
export T3_COMBINED_PIDS="$(mktemp "$HERE/.runtime/logs/combined-pids.XXXXXX")"
export T3_COMBINED_EVIDENCE="$HERE/.runtime/logs/combined-evidence.jsonl"
: > "$T3_COMBINED_EVIDENCE"
cleanup() {
  # PiRpc starts detached groups: timeout alone cannot own those descendants.
  python3 - "$T3_COMBINED_PIDS" <<'PY'
import json, os, signal, sys
for line in open(sys.argv[1]):
    row = json.loads(line)
    try:
        stat = open('/proc/%s/stat' % row['pid']).read().split(') ')[1].split()
        if stat[19] == row['stat']:
            os.killpg(row['pid'], signal.SIGKILL)
    except (FileNotFoundError, ProcessLookupError):
        pass
PY
  rm -f "$TARGET" "$T3_COMBINED_PIDS"
}
trap cleanup EXIT
cp "$HERE/combined-PiAdapterV2.integration.test.ts" "$TARGET"
timeout --signal=TERM --kill-after=3s 20s "$HERE/run.sh" test-ui apps/server/src/orchestration-v2/Adapters/combinedPiDie.integration.test.ts
