#!/bin/sh
set -eu
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$SELF_DIR/launcher.mjs" "$@"
