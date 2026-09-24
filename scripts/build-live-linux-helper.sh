#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(uname -s) == Linux ]] || { echo 'Linux required' >&2; exit 1; }
out=${1:-dist/live-audio-linux}
mkdir -p "$(dirname "$out")"
${CXX:-clang++} -std=c++17 -O2 -Wall -Wextra -pthread native/live-linux/main.cpp -o "$out" $(pkg-config --cflags --libs libpulse webrtc-audio-processing-1 json-c glib-2.0)
