#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
command -v pactl >/dev/null
pactl info >/dev/null # do not start services or change defaults
prefix="die_lab_$$_$RANDOM"
out="$prefix-out"
mic="$prefix-mic"
first=$(pactl load-module module-null-sink sink_name="$out")
trap 'pactl unload-module "$first"' EXIT
second=$(pactl load-module module-null-sink sink_name="$mic")
trap 'pactl unload-module "$second"; pactl unload-module "$first"' EXIT
python3 native/live-lab-linux/tests/protocol.py dist/live-lab-audio-linux --source "$mic.monitor" --sink "$out"
