#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p bin
GOTOOLCHAIN=local go build -trimpath -ldflags="-s -w" -o bin/godie ./cmd/godie
