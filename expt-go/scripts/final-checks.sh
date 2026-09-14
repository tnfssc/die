#!/bin/sh
# No live endpoints or credentials: all provider probes use bounded loopback fixtures.
set -eu
cd "$(dirname "$0")/../.."
export PYTHONDONTWRITEBYTECODE=1
# Keep owned test temporaries outside the repository on the home filesystem.
mkdir -p "$HOME/.cache"
TMPDIR=$(mktemp -d "$HOME/.cache/godie-checks.XXXXXX")
export TMPDIR
trap 'rm -rf "$TMPDIR"' EXIT HUP INT TERM
(cd expt-go && ./scripts/build.sh && sha256sum bin/godie > evidence/FINAL-SHA256.txt && go test -race ./... > evidence/final-source-race.log 2>&1 && go vet ./... > evidence/final-source-vet.log 2>&1)
python3 expt-go/validation/distribution-acceptance.py --binary expt-go/bin/godie --concurrency 50 --json expt-go/evidence/final-distribution.json > expt-go/evidence/final-distribution.log 2>&1
python3 expt-go/scripts/corrupt_payload_probe.py expt-go/bin/godie expt-go/evidence/final-corrupt-payload > expt-go/evidence/final-corrupt-payload.log 2>&1
python3 expt-go/validation/parity.py --baseline expt-go/bin/die-original --candidate expt-go/bin/godie --output expt-go/evidence/final-compare > expt-go/evidence/final-compare.log 2>&1
python3 expt-go/validation/ownership-parity.py --baseline expt-go/bin/die-original --candidate expt-go/bin/godie --output expt-go/evidence/final-ownership > expt-go/evidence/final-ownership.log 2>&1
python3 expt-go/validation/runtime-recheck.py expt-go/bin/godie expt-go/evidence/final-runtime > expt-go/evidence/final-runtime.log 2>&1
python3 expt-go/scripts/execute_parity_probe.py > expt-go/evidence/final-execute.log 2>&1
python3 expt-go/validation/session-replay-parity.py --baseline expt-go/bin/die-original --candidate expt-go/bin/godie --output expt-go/evidence/final-session > expt-go/evidence/final-session.log 2>&1
python3 expt-go/scripts/native_switch_probe.py expt-go/bin/godie expt-go/evidence/final-native > expt-go/evidence/final-native.log 2>&1
python3 expt-go/scripts/streaming_pty_probe.py expt-go/bin/die-original expt-go/bin/godie expt-go/evidence/final-streaming-pty > expt-go/evidence/final-streaming-pty.log 2>&1
python3 expt-go/scripts/product_probe.py expt-go/bin/godie expt-go/evidence/final-product > expt-go/evidence/final-product.log 2>&1
python3 expt-go/scripts/relocation_probe.py expt-go/bin/godie expt-go/evidence/final-relocation > expt-go/evidence/final-relocation.log 2>&1
python3 expt-go/scripts/extraction_probe.py expt-go/bin/godie expt-go/evidence/final-extraction > expt-go/evidence/final-extraction.log 2>&1
# Capture harnesses may exit zero while retaining FAIL/DIFF entries. Inspect the
# manifests, not merely this script's status; PARITY.md explains known differences.
