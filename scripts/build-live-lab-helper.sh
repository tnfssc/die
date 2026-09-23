#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Darwin ]; then echo 'macOS and Xcode are required' >&2; exit 1; fi
xcrun --find swiftc >/dev/null
xcrun --find clang >/dev/null
mkdir -p dist
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
xcrun clang -std=c11 -O2 -Wall -Wextra -c native/live-lab/AudioCore.c -o "$work/AudioCore.o"
xcrun swiftc -O -import-objc-header native/live-lab/AudioCore.h native/live-lab/main.swift "$work/AudioCore.o" -framework AVFoundation -framework CoreFoundation -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/live-lab/Info.plist -o "$work/live-lab-audio"
"$work/live-lab-audio" --self-test
mv "$work/live-lab-audio" dist/live-lab-audio
printf 'Built dist/live-lab-audio; run --help for usage.\n'
