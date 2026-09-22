#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE="$HERE/.runtime/upstream"
export TMPDIR="$HERE/.runtime/tmp"
mkdir -p "$TMPDIR"
TARGET="$SOURCE/apps/server/src/orchestration-v2/testkit/integratedRealPiDie.integration.test.ts"
[[ -d "$SOURCE/node_modules" ]] || { echo "error: run setup.sh first" >&2; exit 1; }
[[ ! -e "$TARGET" ]] || { echo "error: staged target exists" >&2; exit 1; }
HELPER="$SOURCE/apps/server/src/orchestration-v2/testkit/integratedRealHarness.ts"
[[ ! -e "$HELPER" ]] || { echo "error: staged helper exists" >&2; exit 1; }
export T3_INTEGRATED_PIDS="$(mktemp "$HERE/.runtime/integrated-pids.XXXXXX")"
cleanup() {
  python3 - "$T3_INTEGRATED_PIDS" <<'PY'
import json,os,signal,sys
for line in open(sys.argv[1]):
    row=json.loads(line)
    try:
        if open('/proc/%s/stat'%row['pid']).read().split(') ')[1].split()[19]==row['start']:
            os.killpg(row['pid'],signal.SIGKILL)
    except (FileNotFoundError,ProcessLookupError): pass
PY
  rm -f "$TARGET" "$HELPER" "$T3_INTEGRATED_PIDS"
}
trap cleanup EXIT
# Derived isolated harness: enable the real manager MCP credential lifecycle.
python3 - "$SOURCE/apps/server/src/orchestration-v2/testkit/ProviderReplayHarness.ts" "$HELPER" <<'PY'
import sys
s=open(sys.argv[1]).read()
assert s.count('configureMcp: false')==1
assert s.count('../../mcp/McpSessionRegistry.testkit.ts')==1
s=s.replace('configureMcp: false','configureMcp: true').replace('../../mcp/McpSessionRegistry.testkit.ts','../../mcp/McpSessionRegistry.ts')
open(sys.argv[2],'w').write(s)
PY
cp "$HERE/integrated-real-PiAdapterV2.integration.test.ts" "$TARGET"
timeout --signal=TERM --kill-after=5s 55s "$HERE/run.sh" test-ui apps/server/src/orchestration-v2/testkit/integratedRealPiDie.integration.test.ts --disableConsoleIntercept 2>&1 | tee "$HERE/.runtime/integrated-real.log"
