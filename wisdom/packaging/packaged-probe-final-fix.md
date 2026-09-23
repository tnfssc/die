# Packaged WebSocket probe final fix

## Scope

Only `scripts/t3-v2-production/packaged-smoke.ts` and this report changed. No binary, product source, web patch or index, or other harness was rebuilt or edited.

## Root cause and fix

The replacement probe hand-built an Upgrade request with Bun's `node:http` compatibility client. The packaged backend never emitted `upgrade` or `response` for that request, so the probe timed out while the backend stayed healthy. The client and probe did not fit each other. This was not a same-origin backend failure.

The probe now uses Bun 1.4.1's real built-in `WebSocket` client. Its supported headers option sends the exact `Host` and optional `Origin` under test. The client builds and checks the WebSocket handshake. A small local constructor type fills a gap in TypeScript's DOM declaration, which does not include Bun's headers overload. There is no `ws` import or hidden dependency.

The acceptance rules did not change:

- exact same-origin and headerless-local probes must open and record 101;
- cross-origin, wrong-port Origin, alternate Host, and rebinding Host probes must not open;
- HTTP same-origin and hostile Host/Origin checks stay the same.

The old failed diagnostics remain unchanged:

- `artifacts/final-pr/final-live-packaged.log`
- `artifacts/final-pr/final-live-packaged-attempt2.log`
- `artifacts/final-pr/final-live-packaged-debug.log`

## Verification

- `bunx tsc --noEmit`: passed.
- `bunx biome check scripts/t3-v2-production/packaged-smoke.ts`: passed with exit 0. It reported only existing style suggestions.
- Smoke on the exact final packaged binary: passed with exit 0.
  - Binary: `dist/die`
  - SHA-256: `5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1`
  - Manifest: `artifacts/final-pr/final-live-build-manifest.json`
  - New private proof: `artifacts/final-pr/packaged-probe-final-fix-proof.json`
  - New log: `artifacts/final-pr/final-live-packaged-probe-fix.log`

The proof records same-origin = 101 and headerless-local = 101. All four hostile WebSocket cases record 0 because they did not open. `passed` is `true`. HTTP hostile cases still have `authenticated: false`.

Exact command:

```sh
T3_V2_PACKAGED_BINARY=dist/die \
T3_V2_EXPECT_BINARY_SHA256=5fc429976b1720245355e1fb958ef1ed79c2a89afd1351c6ecd23ebd7c5f55d1 \
T3_V2_PACKAGED_MANIFEST=artifacts/final-pr/final-live-build-manifest.json \
T3_V2_PACKAGED_PROOF=artifacts/final-pr/packaged-probe-final-fix-proof.json \
TMPDIR=/var/tmp bun scripts/t3-v2-production/packaged-smoke.ts \
  > artifacts/final-pr/final-live-packaged-probe-fix.log 2>&1
```
