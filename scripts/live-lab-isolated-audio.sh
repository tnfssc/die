#!/usr/bin/env bash
# An owned, hardware-free PipeWire graph; never touches the desktop server.
set -euo pipefail
for tool in pipewire pipewire-pulse wireplumber pw-dump pactl parec pacat python3 bun mktemp timeout; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done
root=$(mktemp -d)
chmod 700 "$root"
mkdir -m 700 "$root/runtime" "$root/config" "$root/state" "$root/cache"
core= pulse= manager= test_pid=
cleanup() {
  local status=$?
  if (( status )); then for log in core pulse manager; do echo "Private $log log:" >&2; tail -15 "$root/$log.log" >&2 2>/dev/null || :; done; fi
  local pid
  local -a test_children=()
  if [[ -n "$test_pid" ]]; then mapfile -t test_children < <(ps -o pid= --ppid "$test_pid" | tr -d ' '); fi
  for pid in "${test_children[@]}" "${test_pid:-}" "${manager:-}" "${pulse:-}" "${core:-}"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || :; fi
  done
  sleep .2
  for pid in "${test_children[@]}" "${test_pid:-}" "${manager:-}" "${pulse:-}" "${core:-}"; do
    if [[ -n "$pid" ]]; then kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || :; wait "$pid" 2>/dev/null || :; fi
  done
  rm -rf -- "$root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export XDG_RUNTIME_DIR="$root/runtime" XDG_CONFIG_HOME="$root/config" XDG_STATE_HOME="$root/state" XDG_CACHE_HOME="$root/cache"
export PIPEWIRE_RUNTIME_DIR="$root/runtime" PIPEWIRE_REMOTE=pipewire-0
export PULSE_SERVER="unix:$root/runtime/pulse/native" PULSE_COOKIE="$root/runtime/pulse-cookie"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$root/runtime/nonexistent-dbus"
# No autospawn, default user configs, system policy or device discovery modules.
export PIPEWIRE_CONFIG_DIR="$root/config" PIPEWIRE_NO_SYSTEM_CONFIG=1
cp /usr/share/pipewire/client.conf "$root/config/client.conf"
cp /usr/share/pipewire/pipewire.conf "$root/config/pipewire.conf"
cp /usr/share/pipewire/pipewire-pulse.conf "$root/config/pipewire-pulse.conf"
cat >>"$root/config/pipewire-pulse.conf" <<'EOF'
pulse.cmd = [ ]
pulse.properties = { server.address = [ "unix:native" ] server.dbus-name = "" }
EOF
pipewire -c pipewire.conf >"$root/core.log" 2>&1 & core=$!
pipewire-pulse -c pipewire-pulse.conf >"$root/pulse.log" 2>&1 & pulse=$!
# The stock 'policy' profile contains linking policy but no ALSA, Bluetooth,
# MIDI, V4L2 or libcamera monitors. Run against our private socket only.
wireplumber -c /usr/share/wireplumber/wireplumber.conf -p policy >"$root/manager.log" 2>&1 & manager=$!
for ((i=0;i<15;i++)); do
  if timeout 2 pactl info >/dev/null 2>&1 && timeout 2 pw-dump >/dev/null 2>&1; then break; fi
  kill -0 "$core" 2>/dev/null && kill -0 "$pulse" 2>/dev/null && kill -0 "$manager" 2>/dev/null || { echo 'Private audio service exited' >&2; exit 1; }
  sleep .1
done
timeout 2 pactl info >/dev/null
# The only permissible pre-test graph has no hardware or other audio nodes.
timeout 2 pw-dump | python3 -c 'import json,sys; nodes=[o.get("info",{}).get("props",{}) for o in json.load(sys.stdin) if o.get("type","").endswith(":Node")]; bad=[n for n in nodes if n.get("node.name") not in ("Dummy-Driver","Freewheel-Driver")]; print("Pre-test graph nodes:",[(n.get("node.name"),n.get("media.class")) for n in nodes]); sys.exit(bool(bad))'
[[ $(timeout 2 pactl -f json list sinks) == '[]' ]] || { echo 'Unexpected sink in private graph' >&2; exit 1; }
[[ $(timeout 2 pactl -f json list sources) == '[]' ]] || { echo 'Unexpected source in private graph' >&2; exit 1; }
DIE_LIVE_LAB_ISOLATED=1 bun scripts/live-lab-acceptance.ts "$@" & test_pid=$!
wait "$test_pid"
