# Packaged WebSocket probe final fix

## Scope

Changed only `scripts/t3-v2-production/packaged-smoke.ts` (plus this report). No binary, product source, web patch/index, or other harness was rebuilt or edited.

## Root cause and fix

The replacement probe used Bun's `node:http` compatibility client to hand-build an Upgrade request. Against the packaged backend this request never emitted either `upgrade` or `response` and timed out, even though the backend remained healthy. This was a probe/client mismatch, not a same-origin backend failure.

The probe now uses Bun 1.4.1's built-in real `WebSocket` client. Its supported headers option supplies the exact `Host` and optional `Origin` under test, while the client generates and validates the WebSocket handshake. A small local constructor type supplements TypeScript's DOM declaration, which omits Bun's headers overload. There is no `ws` import or undeclared dependency.

Acceptance semantics were retained:

- exact same-origin and headerless-local probes must open (recorded as 101);
- cross-origin, wrong-port Origin, alternate Host, and rebinding Host probes must not open;
- HTTP same-origin and hostile Host/Origin assertions are unchanged.

The prior failing diagnostics were not overwritten:

- `artifacts/final-pr/final-live-packaged.log`
- `artifacts/final-pr/final-live-packaged-attempt2.log`
- `artifacts/final-pr/final-live-packaged-debug.log`

## Verification

- `bunx tsc --noEmit`: PASS.
- `bunx biome check scripts/t3-v2-production/packaged-smoke.ts`: PASS (exit 0; informational pre-existing style suggestions only).
- Exact final packaged binary smoke: PASS (exit 0).
  - Binary: `dist/die`
  - SHA-256: `5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1`
  - Manifest: `artifacts/final-pr/final-live-build-manifest.json`
  - New private proof: `artifacts/final-pr/packaged-probe-final-fix-proof.json`
  - New log: `artifacts/final-pr/final-live-packaged-probe-fix.log`

The proof records same-origin = 101, headerless-local = 101, and all four hostile WebSocket cases = 0 (failed to open), with `passed: true`. HTTP hostile cases remain `authenticated: false`.

Exact command:

```sh
T3_V2_PACKAGED_BINARY=dist/die \
T3_V2_EXPECT_BINARY_SHA256=5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1 \
T3_V2_PACKAGED_MANIFEST=artifacts/final-pr/final-live-build-manifest.json \
T3_V2_PACKAGED_PROOF=artifacts/final-pr/packaged-probe-final-fix-proof.json \
TMPDIR=/var/tmp bun scripts/t3-v2-production/packaged-smoke.ts \
  > artifacts/final-pr/final-live-packaged-probe-fix.log 2>&1
```
