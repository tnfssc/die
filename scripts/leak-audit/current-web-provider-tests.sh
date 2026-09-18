#!/usr/bin/env bash
# No external providers: current source's mocked adapter / service lifecycle tests.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
tree="$root/.cache/die-t3code-v0042"
pin=719a76ca1dbf5490f1aa33ffb9966301e02be9a9
[[ $(git -C "$tree" rev-parse HEAD) == "$pin" ]]
node -e 'if(require(process.argv[1]).revision!==process.argv[2])process.exit(1)' "$root/web/t3-source.json" "$pin"
git -C "$tree" apply --reverse --check "$root/web/t3.patch"
cd "$tree/apps/server"
exec ../../node_modules/.bin/vp test run \
 src/provider/Layers/CodexAdapter.test.ts \
 src/provider/Layers/CodexSessionRuntime.test.ts \
 src/provider/Layers/ProviderSessionReaper.test.ts \
 src/provider/Layers/ProviderSessionDirectory.test.ts \
 src/provider/Layers/PiAdapter.test.ts \
 src/provider/pi/PiRpcClient.test.ts \
 src/provider/Layers/ProviderService.test.ts \
 src/provider/Layers/EventNdjsonLogger.test.ts
