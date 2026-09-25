#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TREE="$ROOT/.cache/die-t3code-v0042"
EXPECTED_HEAD="719a76ca1dbf5490f1aa33ffb9966301e02be9a9"

node -e 'if(require(process.argv[1]).revision!==process.argv[2])process.exit(1)' "$ROOT/web/t3-source.json" "$EXPECTED_HEAD"

actual_head="$(git -C "$TREE" rev-parse HEAD)"
[[ "$actual_head" == "$EXPECTED_HEAD" ]] || {
  printf 'wrong canonical HEAD: expected %s, got %s\n' "$EXPECTED_HEAD" "$actual_head" >&2
  exit 2
}
git -C "$TREE" apply --reverse --check "$ROOT/web/t3.patch"

(
  cd "$TREE"
  ./node_modules/.bin/vp test run \
    apps/server/src/terminal/Manager.test.ts \
    apps/server/src/terminal/NodePtyAdapter.test.ts \
    apps/server/src/terminal/BunPtyAdapter.test.ts \
    apps/server/src/terminal/OutputProtocol.test.ts \
    apps/server/src/auth/SessionStore.test.ts
)
(
  cd "$TREE/apps/server"
  ../../node_modules/.bin/vp pack
)

exec node "$ROOT/scripts/leak-audit/current-web-server-runtime.mjs"
