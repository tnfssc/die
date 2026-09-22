#!/usr/bin/env bash
# Copy a CLOSED real-engine database; never overwrite existing browser proof state.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE="$HERE/.runtime/integrated-real-state.sqlite"
TARGET="$HERE/.runtime/browser-live-final-state/t3-home/userdata/statev2.sqlite"
[[ -f "$SOURCE" && -f "$HERE/.runtime/integrated-real-result.json" ]] || { echo "run integrated-process-proof.sh first" >&2; exit 1; }
[[ ! -e "$TARGET" ]] || { echo "browser proof state already exists; preserve/move aside browser-live-final-state and browser-live-profile-final before preparing a different engine run" >&2; exit 1; }
mkdir -p "$(dirname "$TARGET")"
cp "$SOURCE" "$TARGET"
# The engine test has real thread events/projections; only project-list metadata is added.
T3_BROWSER_PROJECT_ONLY=1 bun "$HERE/browser-live-seed.ts"
