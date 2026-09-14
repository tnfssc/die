#!/usr/bin/env sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
install_dir="${DIE_INSTALL_DIR:-$HOME/.local/bin}"
target="$install_dir/die"
temporary="$install_dir/.die-install-$$"
web_source="$root_dir/dist/die-web"
web_temporary="$install_dir/.die-web-install-$$"
web_backup="$install_dir/.die-web-backup-$$"
web_moved=0

cleanup() {
  rm -f "$temporary"
  rm -rf "$web_temporary"
  if [ "$web_moved" -eq 1 ]; then
    rm -rf "$web_target"
    if [ -d "$web_backup" ]; then
      mv -f "$web_backup" "$web_target" || :
    fi
  else
    rm -rf "$web_backup"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$root_dir"
if [ "${DIE_SKIP_BUILD:-0}" != "1" ]; then
  bun run build
fi
mkdir -p "$install_dir"
install -m 755 ./dist/die "$temporary"

# Stage the sidecar before changing the installed CLI or an existing sidecar.
# No staging is done when the optional build output is absent.
if [ -d "$web_source" ]; then
  web_target="$install_dir/die-web"
  mkdir "$web_temporary"
  cp -R "$web_source/." "$web_temporary/"

  if [ -d "$web_target" ]; then
    mv "$web_target" "$web_backup"
    web_moved=1
  fi
  if ! mv "$web_temporary" "$web_target"; then
    exit 1
  fi
fi

mv -f "$temporary" "$target"
web_moved=0
trap - EXIT INT TERM
rm -rf "$web_temporary" "$web_backup"

printf 'Installed die to %s\n' "$target"
case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to invoke die from any terminal.\n' "$install_dir" ;;
esac
