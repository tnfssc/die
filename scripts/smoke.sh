#!/usr/bin/env sh
set -eu

bun run build

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM
cp ./dist/die "$tmp_dir/die"

version="$(env -i HOME="$tmp_dir/home" PATH=/nonexistent "$tmp_dir/die" --version)"
help="$(env -i HOME="$tmp_dir/home" PATH=/nonexistent "$tmp_dir/die" --help)"

[ "$version" = "0.1.0" ]
printf '%s\n' "$help" | grep -q '^die - AI coding assistant'
[ -d "$tmp_dir/home/.die" ]
[ ! -e "$tmp_dir/home/.pi" ]

echo "die standalone smoke test passed"
