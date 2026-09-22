# Setup/run followthrough review

## Changes

- Pin and experiment state path stay hardcoded; tests modify a private fixture copy rather than exposing ambient pin/state overrides.
- Leading-zero offsets are normalized as decimal before arithmetic.
- New setup clones prefer a local mirror containing the exact pin, otherwise use https://github.com/pingdotgg/t3code.git and fetch the pinned commit if necessary. --no-local --dissociate avoids research-checkout alternates for **new** clones.
- Setup refuses a mismatched existing runtime instead of resetting/deleting active state. The current pre-existing runtime was deliberately not rematerialized.
- Setup/run compare the tracked diff with upstream.patch and reject unexpected untracked sources. Exclusions are limited to named combined/clock/integrated diagnostics, the derived integrated harness, and the explicitly instrumented replay fixture used by the historical browser capture.
- run.sh verify validates the pinned patched tree without launching a server; browser-live-run.sh invokes it before launching its separate state namespace.
- Setup records existing binary SHA-256, checkout revision and tracked-dirty status, and explicitly labels binary build provenance unverified. It does not rebuild/copy/modify the binary or reject unrelated pre-existing note edits. Later setup rejects a changed recorded artifact/revision.

## Binary contract and limits

Launcher/setup support DIE_T3_DIE_BIN, defaulting to dist/die. The current approved real-engine/combined/bridge regression evidence deliberately exercises the preserved root dist/die, not an arbitrary alternate. A clean no-binary checkout still cannot reproduce this evidence without obtaining that artifact. A freshly built isolated binary and clean canonical-source bootstrap were **not** validated in this followthrough; do not mark these as a full clean-build reproducibility pass.

Root .gitignore research-checkout hygiene remains coordinator-owned. No root change, runtime reset, production rebuild, installed-binary modification, or private credential access was performed.

## Validation

Shell syntax checks pass. Four fixture isolation tests pass: invalid offsets, decimal leading zeros, no host/state flag overrides, tracked drift rejection with named staged diagnostic allowance. The existing runtime passes run.sh verify. Broader prototype tests are listed in RESULTS.md.
