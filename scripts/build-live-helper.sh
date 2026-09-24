#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Darwin ]; then echo 'macOS and Xcode are required' >&2; exit 1; fi
xcrun --find swiftc >/dev/null
xcrun --find clang >/dev/null
mkdir -p dist
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
xcrun clang -std=c11 -O2 -Wall -Wextra -c native/live/AudioCore.c -o "$work/AudioCore.o"
xcrun swiftc -O -import-objc-header native/live/AudioCore.h native/live/main.swift "$work/AudioCore.o" -framework AVFoundation -framework CoreFoundation -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/live/Info.plist -o "$work/live-audio"
"$work/live-audio" --self-test
mv "$work/live-audio" dist/live-audio
printf 'Built dist/live-audio; run --help for usage.\n'
