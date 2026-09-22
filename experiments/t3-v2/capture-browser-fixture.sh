#!/usr/bin/env bash
# Materialize upstream's deterministic subagent_v2_nested replay through its real orchestration harness.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE="$HERE/.runtime/upstream"
TEST="$SOURCE/apps/server/src/orchestration-v2/testkit/OrchestratorReplayFixtures.integration.test.ts"
OUT="$HERE/.runtime/subagent-v2-nested-result.json"
BACKUP="$HERE/.runtime/OrchestratorReplayFixtures.integration.test.ts.browser-backup"
mkdir -p "$HERE/.runtime/browser-tmp"
export TMPDIR="$HERE/.runtime/browser-tmp"
[[ -f "$TEST" ]] || { echo "run setup.sh first" >&2; exit 1; }
cp "$TEST" "$BACKUP"
trap 'cp "$BACKUP" "$TEST"; rm -f "$BACKUP"' EXIT
python3 - "$TEST" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text()
s=s.replace('import { writeFileSync } from "node:fs";\n','')
start='  if (input.fixtureName === "subagent_v2_nested") {'
if start in s:
    a=s.index(start); b=s.index('  }\n',a)+4; s=s[:a]+s[b:]
s='import { writeFileSync } from "node:fs";\n'+s
needle='  return result;'
probe='''  if (input.fixtureName === \"subagent_v2_nested\") {
    writeFileSync(process.env.T3_BROWSER_DUMP!, JSON.stringify(result, (_key, value) => value instanceof Map ? Object.fromEntries(value) : value));
  }
'''
s=s.replace(needle,probe+needle,1)
p.write_text(s)
PY
T3_BROWSER_DUMP="$OUT" "$HERE/run.sh" test-ui \
  apps/server/src/orchestration-v2/testkit/OrchestratorReplayFixtures.integration.test.ts \
  -t "subagent_v2_nested/codex"
echo "$OUT"
