#!/bin/sh
set -eu
# Rebuild the checked-in Linux amd64 Bun payload from a separately obtained,
# official Bun 1.4.1 executable. This script never installs or downloads Bun.
SOURCE=${1:?usage: build-runtime-assets.sh /path/to/bun-1.4.1}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WANT=69293d3be4f0d6d624ca8581af4574435fa39209ab67e89eb03912866f3e14cb
GOT=$(sha256sum "$SOURCE" | awk '{print $1}')
[ "$GOT" = "$WANT" ] || { echo "unexpected Bun bytes: $GOT" >&2; exit 1; }
tmp="$ROOT/internal/runtime/assets/.bun-linux-amd64.gz.$$"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
gzip -9 -n -c "$SOURCE" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ROOT/internal/runtime/assets/bun-linux-amd64.gz"
trap - EXIT HUP INT TERM
