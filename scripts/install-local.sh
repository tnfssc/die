#!/usr/bin/env sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
install_dir="${DIE_INSTALL_DIR:-$HOME/.local/bin}"
target="$install_dir/die"
temporary="$install_dir/.die-install-$$"

cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT INT TERM

cd "$root_dir"
if [ "${DIE_SKIP_BUILD:-0}" != "1" ]; then
  bun run build
fi
mkdir -p "$install_dir"
install -m 755 ./dist/die "$temporary"
mv -f "$temporary" "$target"
trap - EXIT INT TERM

printf 'Installed die to %s\n' "$target"
case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to invoke die from any terminal.\n' "$install_dir" ;;
esac
