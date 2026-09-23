#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
command -v pactl >/dev/null
pactl info >/dev/null # do not start services or change defaults
prefix="die_lab_$$_$RANDOM"
out="$prefix-out"
mic="$prefix-mic"
first=$(pactl load-module module-null-sink sink_name="$out")
trap 'pactl unload-module "$first" 2>/dev/null || true' EXIT
second=$(pactl load-module module-null-sink sink_name="$mic")
trap 'pactl unload-module "$second" 2>/dev/null || true; pactl unload-module "$first" 2>/dev/null || true' EXIT
python3 native/live-lab-linux/tests/protocol.py "${1:-dist/live-lab-audio-linux}" --source "$mic.monitor" --sink "$out"

python3 native/live-lab-linux/tests/source-removal.py "${1:-dist/live-lab-audio-linux}" "$mic.monitor" "$out" "$second"
