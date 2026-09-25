#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE="$HERE/.runtime/upstream"
TARGET="$SOURCE/apps/server/src/orchestration-v2/Adapters/clockPiRpc.integration.test.ts"
PIN_FILE="$(mktemp "$HERE/.runtime/clock-pids.XXXXXX")"
command -v timeout >/dev/null || { echo "error: GNU timeout required" >&2; exit 1; }
[[ -d "$SOURCE/node_modules" ]] || { echo "error: run setup.sh first" >&2; exit 1; }
[[ ! -e "$TARGET" ]] || { echo "error: target already exists" >&2; exit 1; }
cleanup() {
  python3 - "$PIN_FILE" <<'PY'
import json, os, signal, sys
try: lines = open(sys.argv[1]).readlines()
except OSError: lines = []
for line in lines:
    try: row = json.loads(line)
    except Exception: continue
    group = row.get("pid")
    anchors = [(row.get("pid"), row.get("start")), (row.get("childPid"), row.get("childStart"))]
    matched = False
    for pid, expected in anchors:
        if not pid or expected is None: continue
        try:
            actual = open("/proc/%s/stat" % pid).read().split(") ")[1].split()[19]
            matched = matched or actual == str(expected)
        except (FileNotFoundError, ProcessLookupError): pass
    if matched and group:
        try: os.killpg(group, signal.SIGKILL)
        except ProcessLookupError: pass
PY
  rm -f "$TARGET" "$PIN_FILE"
}
trap cleanup EXIT INT TERM
cp "$HERE/clock-PiRpc.integration.test.ts" "$TARGET"
export CLOCK_PIN_FILE="$PIN_FILE"
timeout --signal=TERM --kill-after=5s 35s "$HERE/run.sh" test-ui apps/server/src/orchestration-v2/Adapters/clockPiRpc.integration.test.ts
